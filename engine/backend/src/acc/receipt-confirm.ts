// ----------------------------------------------------------------------------
// acc/receipt-confirm — what follows finance confirming a customer payment.
//
// Conts (chew, 29 Oct 2026; SOP 4.2/4.5): "Salesperson 在系统更新收款 → 财务核对
// 银行确实收到 → 才算已收，项目额度才增加". The salesperson records the payment
// as before; it stays a DRAFT receipt and posts nothing. Finance checks the bank
// statement and confirms it — the receipt turns FORMAL on the bank it landed in
// (the manual confirm), or on the acquirer's payout bank (card settlement, and
// the receipts backfill that replays it). Only then is the money received:
//   • the payment posts (Dr that bank, or the card clearing account / Cr the
//     customer's control) — acc/payments posts only a confirmed payment;
//   • an order payment's deposit invoice issues;
//   • the project limit counts it (conts/project-limit reads FORMAL receipts).
//
// Best-effort from the confirmer's point of view, like every hook after the
// money: the receipt is formal either way; a posting refusal is returned to
// the manual confirm, logged elsewhere, and healed by the customer-payment
// backfill (Self-check), which posts every confirmed payment it finds.
// ----------------------------------------------------------------------------

import { postSiPayment, postSoPayment, type PostPaymentResult, type SiPaymentRow, type SoPaymentRow } from './payments';
import { formaliseReceiptsForSettlement, receiptConfirmation } from './receipts';
import { issueDepositInvoiceBestEffort } from './deposit-invoices';
import { reverseJournal } from './engine';
import { resolveRoles } from './rules';

/* The untyped client the poster takes, borrowed rather than spelled out again
   (a new file's lint ceiling is zero — payout-charge.ts's reason). */
type Db = Parameters<typeof postSoPayment>[0];

const log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('[acc/receipt-confirm]', ...args);
};

/** A cash / transfer payment posted BEFORE confirmation existed sits on the
    accounts of the old rule (cash CASH, transfer BANK_DEFAULT). Confirmed now
    onto another bank, its entry is reversed — the contra dated on the original
    entry, as an edit's is (acc/payment-repost) — so the post that follows lands
    on the bank finance chose. Nothing to do when it already sits there. */
async function alignToConfirmedBank(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  method: string,
): Promise<{ ok: true } | { ok: false; status: string; reason: string }> {
  if (method !== 'cash' && method !== 'transfer') return { ok: true };
  const conf = await receiptConfirmation(sb, companyId, source, paymentId);
  if (!conf.ok) return { ok: false, status: 'receipt_read_failed', reason: conf.reason };
  if (!conf.confirmed || conf.legacy) return { ok: true };
  const bank = conf.channelAccountCode || (await resolveRoles(sb, companyId)).BANK_DEFAULT;
  const { data: jes, error: jeErr } = await sb.from('journal_entries')
    .select('id, je_no, entry_date, reversed').eq('source_type', source).eq('source_doc_no', paymentId).eq('company_id', companyId);
  if (jeErr) return { ok: false, status: 'entry_read_failed', reason: jeErr.message };
  const live = ((jes ?? []) as Array<{ id: string; entry_date: string | null; reversed: boolean | null }>).find((j) => j.reversed !== true);
  if (!live) return { ok: true };
  const { data: lines, error: lErr } = await sb.from('journal_entry_lines').select('account_code, debit_sen').eq('journal_entry_id', live.id);
  if (lErr) return { ok: false, status: 'entry_read_failed', reason: lErr.message };
  if (((lines ?? []) as Array<{ account_code: string; debit_sen: number | null }>).some((l) => Number(l.debit_sen ?? 0) > 0 && l.account_code === bank)) return { ok: true };
  const undone = await reverseJournal(sb, {
    sourceType: source,
    sourceDocNo: paymentId,
    companyId,
    entryDate: String(live.entry_date ?? '').slice(0, 10) || undefined,
    narration: (orig) => `Reversal of ${orig.je_no} — payment confirmed onto ${bank}`,
  });
  if (!undone.ok) return { ok: false, status: undone.status, reason: undone.reason ?? 'the old entry could not be reversed' };
  return { ok: true };
}

/** Post one confirmed payment, by its source, from the row as stored — and
    issue an order payment's deposit invoice. Idempotent: a posted payment
    answers already_posted, a standing invoice already_issued. */
export async function postConfirmedPayment(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
): Promise<PostPaymentResult> {
  if (source === 'SIPAY') {
    const { data, error } = await sb.from('sales_invoice_payments')
      .select('id, sales_invoice_id, paid_at, method, merchant_provider, amount_sen, company_id')
      .eq('id', paymentId).eq('company_id', companyId).maybeSingle();
    if (error) return { ok: false, status: 'payment_read_failed', reason: error.message };
    if (!data) return { ok: false, status: 'payment_not_found', reason: `invoice payment ${paymentId} not found` };
    const aligned = await alignToConfirmedBank(sb, 'SIPAY', paymentId, companyId, String((data as SiPaymentRow).method));
    if (!aligned.ok) return aligned;
    return postSiPayment(sb, data as SiPaymentRow);
  }
  const { data, error } = await sb.from('mfg_sales_order_payments')
    .select('id, so_doc_no, paid_at, method, merchant_provider, amount_sen, company_id, converted_from_so_doc_no, created_at, created_by')
    .eq('id', paymentId).eq('company_id', companyId).maybeSingle();
  if (error) return { ok: false, status: 'payment_read_failed', reason: error.message };
  if (!data) return { ok: false, status: 'payment_not_found', reason: `order payment ${paymentId} not found` };
  const aligned = await alignToConfirmedBank(sb, 'SOPAY', paymentId, companyId, String((data as SoPaymentRow).method));
  if (!aligned.ok) return aligned;
  const posted = await postSoPayment(sb, data as SoPaymentRow);
  /* The deposit invoice stands on the confirmation, not on the posting: a
     posting refusal (a customer with no account yet) is healed separately. */
  await issueDepositInvoiceBestEffort(sb, data as Record<string, unknown>, 'confirm');
  return posted;
}

/** Settlement's confirm (and the receipts backfill replaying it): the card
    receipts turn FORMAL on the payout bank, and each confirmed payment posts
    (an already-formal one too: a retry after a refused post heals, and a posted
    one echoes). Never throws; the outcomes are formaliseReceiptsForSettlement's. */
export async function confirmReceiptsForSettlement(
  sb: Db,
  companyId: number,
  companyCode: string,
  payments: Array<{ source: string; id: string }>,
  bankAccountCode: string | null,
  actor: string | null,
): Promise<Array<{ paymentId: string; outcome: string }>> {
  const outcomes = await formaliseReceiptsForSettlement(sb, companyId, companyCode, payments, bankAccountCode, actor);
  for (const o of outcomes) {
    if (o.outcome !== 'formalised' && o.outcome !== 'already_formal') continue;
    const source = payments.find((p) => p.id === o.paymentId)?.source === 'SIPAY' ? 'SIPAY' : 'SOPAY';
    try {
      const r = await postConfirmedPayment(sb, source, o.paymentId, companyId);
      if (!r.ok) log(`settlement: ${source} ${o.paymentId} confirmed but not posted:`, r.status, r.reason);
    } catch (e) {
      log(`settlement: posting ${source} ${o.paymentId} threw:`, e);
    }
  }
  return outcomes;
}
