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
import { formaliseReceiptsForSettlement } from './receipts';
import { issueDepositInvoiceBestEffort } from './deposit-invoices';

/* The untyped client the poster takes, borrowed rather than spelled out again
   (a new file's lint ceiling is zero — payout-charge.ts's reason). */
type Db = Parameters<typeof postSoPayment>[0];

const log = (...args: unknown[]): void => {
  // eslint-disable-next-line no-console
  console.error('[acc/receipt-confirm]', ...args);
};

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
    return postSiPayment(sb, data as SiPaymentRow);
  }
  const { data, error } = await sb.from('mfg_sales_order_payments')
    .select('id, so_doc_no, paid_at, method, merchant_provider, amount_sen, company_id, converted_from_so_doc_no, created_at, created_by')
    .eq('id', paymentId).eq('company_id', companyId).maybeSingle();
  if (error) return { ok: false, status: 'payment_read_failed', reason: error.message };
  if (!data) return { ok: false, status: 'payment_not_found', reason: `order payment ${paymentId} not found` };
  const posted = await postSoPayment(sb, data as SoPaymentRow);
  /* The deposit invoice stands on the confirmation, not on the posting: a
     posting refusal (a customer with no account yet) is healed separately. */
  await issueDepositInvoiceBestEffort(sb, data as Record<string, unknown>, 'confirm');
  return posted;
}

/** Settlement's confirm (and the receipts backfill replaying it): the card
    receipts turn FORMAL on the payout bank, and each one formalised now posts
    its payment. Never throws; the outcomes are formaliseReceiptsForSettlement's. */
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
    if (o.outcome !== 'formalised') continue;
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
