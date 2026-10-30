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
import { paymentReconciliation } from './payment-reconciled';
import { creditConfirmedPaymentOfCancelledSo } from '../scm/lib/customer-credits';

/* The untyped client the poster takes, borrowed rather than spelled out again
   (a new file's lint ceiling is zero — payout-charge.ts's reason). */
type Db = Parameters<typeof postSoPayment>[0];

const log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('[acc/receipt-confirm]', ...args);
};

type Fail = { ok: false; status: string; reason: string };

/** The payment's live posted entry when it debits a money account OTHER than
    `bank` — a cash / transfer payment posted before confirmation existed, on the
    old rule's account (cash CASH, transfer BANK_DEFAULT). Null when there is no
    live entry or it already sits on `bank`. */
async function entryOnAnotherBank(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  bank: string,
): Promise<{ ok: true; entry: { id: string; entry_date: string | null; account: string } | null } | Fail> {
  const { data: jes, error: jeErr } = await sb.from('journal_entries')
    .select('id, je_no, entry_date, reversed').eq('source_type', source).eq('source_doc_no', paymentId).eq('company_id', companyId);
  if (jeErr) return { ok: false, status: 'entry_read_failed', reason: jeErr.message };
  const live = ((jes ?? []) as Array<{ id: string; entry_date: string | null; reversed: boolean | null }>).find((j) => j.reversed !== true);
  if (!live) return { ok: true, entry: null };
  const { data: lines, error: lErr } = await sb.from('journal_entry_lines').select('account_code, debit_sen').eq('journal_entry_id', live.id);
  if (lErr) return { ok: false, status: 'entry_read_failed', reason: lErr.message };
  const debit = ((lines ?? []) as Array<{ account_code: string; debit_sen: number | null }>).find((l) => Number(l.debit_sen ?? 0) > 0);
  if (!debit || debit.account_code === bank) return { ok: true, entry: null };
  return { ok: true, entry: { id: live.id, entry_date: live.entry_date, account: debit.account_code } };
}

/** May this payment be confirmed onto `bank`? Refused (with the sentence to
    show) when it was posted before confirmation existed onto ANOTHER account
    and that entry is already reconciled — matched on a bank statement, in a
    closed month, settled on a merchant report (acc/payment-reconciled, the
    edit path's own check): the books closed over it, so it is not moved, and
    finance confirms it on the account it sits on. Fails closed. */
export async function bankChangeRefusal(
  sb: Db,
  p: { source: 'SOPAY' | 'SIPAY'; paymentId: string; companyId: number; method: string; bank: string },
): Promise<{ ok: true; refusal: string | null } | Fail> {
  if (p.method !== 'cash' && p.method !== 'transfer') return { ok: true, refusal: null };
  const on = await entryOnAnotherBank(sb, p.source, p.paymentId, p.companyId, p.bank);
  if (!on.ok) return on;
  if (!on.entry) return { ok: true, refusal: null };
  const rec = await paymentReconciliation(sb, p.companyId, p.paymentId, p.source);
  if (!rec.ok) return { ok: false, status: 'reconciliation_unreadable', reason: `Could not check whether this payment is already reconciled, so nothing was changed (${rec.reason}).` };
  if (!rec.by) return { ok: true, refusal: null };
  const where = rec.by.kind === 'bank' ? `matched on the bank statement (entry ${rec.by.jeNo})`
    : rec.by.kind === 'month' ? `in the closed month ${rec.by.month}`
    : `settled on the merchant report of ${rec.by.on}`;
  return { ok: true, refusal: `This payment is already posted to ${on.entry.account} and ${where}, so it cannot move to ${p.bank}: confirm it on ${on.entry.account}.` };
}

/** A cash / transfer payment posted BEFORE confirmation existed sits on the
    accounts of the old rule (cash CASH, transfer BANK_DEFAULT). Confirmed now
    onto another bank, its entry is reversed — the contra dated on the original
    entry, as an edit's is (acc/payment-repost) — so the post that follows lands
    on the bank finance chose. Nothing to do when it already sits there; never
    done to an entry already reconciled (bankChangeRefusal, which the confirm
    route asks first; asked again here so no other caller can move one). */
async function alignToConfirmedBank(
  sb: Db,
  source: 'SOPAY' | 'SIPAY',
  paymentId: string,
  companyId: number,
  method: string,
): Promise<{ ok: true } | Fail> {
  if (method !== 'cash' && method !== 'transfer') return { ok: true };
  const conf = await receiptConfirmation(sb, companyId, source, paymentId);
  if (!conf.ok) return { ok: false, status: 'receipt_read_failed', reason: conf.reason };
  if (!conf.confirmed || conf.legacy) return { ok: true };
  const bank = conf.channelAccountCode || (await resolveRoles(sb, companyId)).BANK_DEFAULT;
  const on = await entryOnAnotherBank(sb, source, paymentId, companyId, bank);
  if (!on.ok) return on;
  if (!on.entry) return { ok: true };
  const live = on.entry;
  const refused = await bankChangeRefusal(sb, { source, paymentId, companyId, method, bank });
  if (!refused.ok) return refused;
  if (refused.refusal) return { ok: false, status: 'payment_reconciled', reason: refused.refusal };
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
  /* True only when THIS call's confirmation turned the receipt formal: a payment confirmed before its order was
     cancelled is already in the cancel-time credit, and a re-run must not add it again. */
  opts: { newlyConfirmed?: boolean } = {},
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
  /* A cancelled order credited the money confirmed when it was cancelled;
     money confirmed since joins the customer's credit (idempotent per payment). */
  if (!opts.newlyConfirmed) return posted;
  const row = data as SoPaymentRow;
  const credited = await creditConfirmedPaymentOfCancelledSo(sb, {
    paymentId, docNo: row.so_doc_no, amountSen: Number(row.amount_sen), method: row.method, companyId,
  });
  if (credited.reason && credited.reason !== 'order_live' && credited.reason !== 'already_credited') log('confirm: cancelled-order credit not added:', paymentId, credited.reason);
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
      const r = await postConfirmedPayment(sb, source, o.paymentId, companyId, { newlyConfirmed: o.outcome === 'formalised' });
      if (!r.ok) log(`settlement: ${source} ${o.paymentId} confirmed but not posted:`, r.status, r.reason);
    } catch (e) {
      log(`settlement: posting ${source} ${o.paymentId} threw:`, e);
    }
  }
  return outcomes;
}
