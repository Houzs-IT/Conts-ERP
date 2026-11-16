// Conts only (not part of Houzs's code): what a payment voucher settles when it posts or is cancelled (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5-4.6).
//   a top-up (petty_cash_float_id)  posting records the money paid to the keeper and marks the receipts it covers topped up
//   a pay-back (staff_receipt_id)    posting marks the receipt paid back
//   a request (payment_request_id)   posting or cancelling recomputes the request's status from its posted vouchers
// Cancelling undoes exactly what posting did. Posting again (or the already-posted path) adds nothing: the money paid
// in is unique per voucher, and every other step only moves rows still in the state it expects. Best effort, like the
// refund hooks beside it: a failure is logged and never undoes the voucher.
import { linkedRequestStatus, requestStatus } from './payment-requests';
import { postedPaid } from './request-vouchers';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the voucher routes */
type Db = any;
interface VoucherLinks { id: string; voucher_date: string; petty_cash_float_id: string | null; staff_receipt_id: string | null; payment_request_id: string | null }

/** supabase-js returns errors rather than throwing them: turn one into a throw, so the hook logs it. */
function must<T>(r: { data?: T; error?: { message?: string } | null }): T | undefined {
  if (r.error) throw new Error(r.error.message ?? 'write failed');
  return r.data;
}
const isUniqueClash = (e: { code?: string; message?: string }) => e.code === '23505' || /duplicate key/i.test(String(e.message ?? ''));
const stamp = () => new Date().toISOString();

async function links(sb: Db, pvId: string): Promise<VoucherLinks | null> {
  const data = must(await sb.from('payment_vouchers').select('id, voucher_date, petty_cash_float_id, staff_receipt_id, payment_request_id').eq('id', pvId).maybeSingle());
  return (data as VoucherLinks | null) ?? null;
}

/** The requests a voucher pays: the one it names, and each its lines name (migration 0330). */
async function requestsOf(sb: Db, pv: VoucherLinks): Promise<string[]> {
  const lines = (must(await sb.from('payment_voucher_lines').select('payment_request_id').eq('pv_id', pv.id)) ?? []) as Array<{ payment_request_id?: string | null }>;
  return [...new Set([pv.payment_request_id, ...lines.map(l => l.payment_request_id)].filter((x): x is string => !!x))];
}

async function voucherSen(sb: Db, pvIds: string[]): Promise<number> {
  if (pvIds.length === 0) return 0;
  const data = must(await sb.from('payment_voucher_lines').select('amount_sen').in('pv_id', pvIds));
  return ((data ?? []) as Array<{ amount_sen: number }>).reduce((n, l) => n + Number(l.amount_sen), 0);
}

/** A request's status from what pays it: its own posted vouchers, and, when it is paid through an AP invoice (chew,
 *  15 Nov 2026), what that bill has had paid since the request was linked (payment-requests.ts linkedRequestStatus). */
export async function settleRequest(sb: Db, requestId: string): Promise<void> {
  const req = must(await sb.from('payment_requests').select('id, type, amount_sen, status, ap_invoice_id, ap_paid_before_sen').eq('id', requestId).maybeSingle()) as
    { type?: string; amount_sen: number; status: string; ap_invoice_id?: string | null; ap_paid_before_sen?: number | null } | null | undefined;
  if (!req) return;
  /* Its own lines on posted vouchers: a voucher for it alone, or a line of a voucher paying several (0330). */
  const paid = (await postedPaid(sb, [requestId])).get(requestId) ?? 0;
  let ap: { status: string; paidSen: number } | null = null;
  if (req.ap_invoice_id) {
    const bill = must(await sb.from('ap_invoices').select('status, paid_sen').eq('id', req.ap_invoice_id).maybeSingle()) as { status: string; paid_sen: number | null } | null | undefined;
    if (bill) ap = { status: String(bill.status), paidSen: Number(bill.paid_sen ?? 0) };
  }
  const next = req.ap_invoice_id
    ? linkedRequestStatus({ type: String(req.type ?? 'PAYMENT'), amountSen: Number(req.amount_sen), current: String(req.status), ownPaidSen: paid, ap, apPaidBeforeSen: Number(req.ap_paid_before_sen ?? 0) })
    : requestStatus(Number(req.amount_sen), paid, String(req.status));
  if (next !== req.status) must(await sb.from('payment_requests').update({ status: next, updated_at: stamp() }).eq('id', requestId));
}

/** Every request paid through this AP invoice, settled again: its paid, status or total just moved (a voucher allocating
 *  to it posted or was cancelled, an advance was applied, the bill was edited). Best effort: a failure is logged and
 *  never undoes what moved the bill. */
export async function settleRequestsOfBillBestEffort(sb: Db, apInvoiceId: string): Promise<void> {
  try {
    const rows = (must(await sb.from('payment_requests').select('id').eq('ap_invoice_id', apInvoiceId)) ?? []) as Array<{ id: string }>;
    for (const r of rows) await settleRequest(sb, r.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] settling the requests of AP invoice ${apInvoiceId} failed:`, (e as Error).message);
  }
}

export async function afterVoucherPostedBestEffort(sb: Db, pvId: string): Promise<void> {
  try {
    const pv = await links(sb, pvId);
    if (!pv) return;
    if (pv.petty_cash_float_id) {
      const amount = await voucherSen(sb, [pv.id]);
      if (amount > 0) {
        const ins = await sb.from('petty_cash_events').insert({ float_id: pv.petty_cash_float_id, kind: 'PAID_IN', amount_sen: amount, pv_id: pv.id, event_date: String(pv.voucher_date).slice(0, 10) });
        if (ins.error && !isUniqueClash(ins.error)) throw new Error(ins.error.message);
      }
      must(await sb.from('staff_receipts').update({ status: 'TOPPED_UP', updated_at: stamp() }).eq('topup_pv_id', pv.id).eq('status', 'CHECKED'));
    }
    if (pv.staff_receipt_id) {
      must(await sb.from('staff_receipts').update({ status: 'PAID_BACK', payback_pv_id: pv.id, updated_at: stamp() }).eq('id', pv.staff_receipt_id).eq('status', 'CHECKED'));
    }
    /* A voucher paying several claims back at once (combined-voucher.ts): each claim it carries. */
    must(await sb.from('staff_receipts').update({ status: 'PAID_BACK', updated_at: stamp() }).eq('payback_pv_id', pv.id).eq('status', 'CHECKED'));
    for (const q of await requestsOf(sb, pv)) await settleRequest(sb, q);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] settling voucher ${pvId} after posting failed:`, (e as Error).message);
  }
}

export async function afterVoucherCancelledBestEffort(sb: Db, pvId: string): Promise<void> {
  try {
    const pv = await links(sb, pvId);
    if (!pv) return;
    if (pv.petty_cash_float_id) {
      must(await sb.from('petty_cash_events').delete().eq('pv_id', pv.id));
      /* Its receipts wait for the next top-up again. */
      must(await sb.from('staff_receipts').update({ status: 'CHECKED', topup_pv_id: null, updated_at: stamp() }).eq('topup_pv_id', pv.id));
    }
    if (pv.staff_receipt_id) {
      must(await sb.from('staff_receipts').update({ status: 'CHECKED', payback_pv_id: null, updated_at: stamp() }).eq('id', pv.staff_receipt_id).eq('payback_pv_id', pv.id));
    }
    must(await sb.from('staff_receipts').update({ status: 'CHECKED', payback_pv_id: null, updated_at: stamp() }).eq('payback_pv_id', pv.id).in('status', ['CHECKED', 'PAID_BACK']));
    for (const q of await requestsOf(sb, pv)) await settleRequest(sb, q);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] undoing voucher ${pvId} after cancelling failed:`, (e as Error).message);
  }
}
