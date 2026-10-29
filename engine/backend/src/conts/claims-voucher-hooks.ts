// Conts only (not part of Houzs's code): what a payment voucher settles when it posts or is cancelled (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.5-4.6).
//   a top-up (petty_cash_float_id)  posting records the money paid to the keeper and marks the checked receipts topped up
//   a pay-back (staff_receipt_id)    posting marks the receipt paid back
//   a request (payment_request_id)   posting or cancelling recomputes the request's status from its posted vouchers
// Cancelling undoes exactly what posting did. Best effort, like the refund hooks beside it: a failure is logged and
// never undoes the voucher.
import { requestStatus } from './payment-requests';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the voucher routes */
type Db = any;
interface VoucherLinks { id: string; voucher_date: string; petty_cash_float_id: string | null; staff_receipt_id: string | null; payment_request_id: string | null }

async function links(sb: Db, pvId: string): Promise<VoucherLinks | null> {
  const { data, error } = await sb.from('payment_vouchers').select('id, voucher_date, petty_cash_float_id, staff_receipt_id, payment_request_id').eq('id', pvId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VoucherLinks | null) ?? null;
}

async function voucherSen(sb: Db, pvIds: string[]): Promise<number> {
  if (pvIds.length === 0) return 0;
  const { data, error } = await sb.from('payment_voucher_lines').select('amount_sen').in('pv_id', pvIds);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ amount_sen: number }>).reduce((n, l) => n + Number(l.amount_sen), 0);
}

async function settleRequest(sb: Db, requestId: string): Promise<void> {
  const { data: req } = await sb.from('payment_requests').select('id, amount_sen, status').eq('id', requestId).maybeSingle();
  if (!req) return;
  const { data: pvs } = await sb.from('payment_vouchers').select('id').eq('payment_request_id', requestId).eq('status', 'POSTED');
  const paid = await voucherSen(sb, ((pvs ?? []) as Array<{ id: string }>).map(p => p.id));
  const next = requestStatus(Number(req.amount_sen), paid, String(req.status));
  if (next !== req.status) await sb.from('payment_requests').update({ status: next, updated_at: new Date().toISOString() }).eq('id', requestId);
}

export async function afterVoucherPostedBestEffort(sb: Db, pvId: string): Promise<void> {
  try {
    const pv = await links(sb, pvId);
    if (!pv) return;
    if (pv.petty_cash_float_id) {
      const amount = await voucherSen(sb, [pv.id]);
      const { data: f } = await sb.from('petty_cash_floats').select('id, company_id').eq('id', pv.petty_cash_float_id).maybeSingle();
      if (amount > 0) await sb.from('petty_cash_events').insert({ float_id: pv.petty_cash_float_id, kind: 'PAID_IN', amount_sen: amount, pv_id: pv.id, event_date: String(pv.voucher_date).slice(0, 10) });
      if (f) {
        await sb.from('staff_receipts').update({ status: 'TOPPED_UP', topup_pv_id: pv.id, updated_at: new Date().toISOString() })
          .eq('company_id', f.company_id).eq('float_id', pv.petty_cash_float_id).eq('status', 'CHECKED').is('topup_pv_id', null);
      }
    }
    if (pv.staff_receipt_id) {
      await sb.from('staff_receipts').update({ status: 'PAID_BACK', payback_pv_id: pv.id, updated_at: new Date().toISOString() }).eq('id', pv.staff_receipt_id).eq('status', 'CHECKED');
    }
    if (pv.payment_request_id) await settleRequest(sb, pv.payment_request_id);
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
      await sb.from('petty_cash_events').delete().eq('pv_id', pv.id);
      await sb.from('staff_receipts').update({ status: 'CHECKED', topup_pv_id: null, updated_at: new Date().toISOString() }).eq('topup_pv_id', pv.id).eq('status', 'TOPPED_UP');
    }
    if (pv.staff_receipt_id) {
      await sb.from('staff_receipts').update({ status: 'CHECKED', payback_pv_id: null, updated_at: new Date().toISOString() }).eq('id', pv.staff_receipt_id).eq('payback_pv_id', pv.id);
    }
    if (pv.payment_request_id) await settleRequest(sb, pv.payment_request_id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[claims] undoing voucher ${pvId} after cancelling failed:`, (e as Error).message);
  }
}
