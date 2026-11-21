// Conts only (not part of Houzs's code): which payment requests still wait for finance to pay — the one rule the
// Payment requests menu count (my-claims-routes.ts financeWaitingHandler) and Finance's To do (finance-todo-routes.ts)
// both read, so the two never disagree. A request still SUBMITTED waits unless finance has started on it: a voucher
// that is not cancelled pays it, or a live (not cancelled) AP invoice was made from it (chew, 20 Nov 2026).
import { requestPayments } from './request-vouchers';

/* eslint-disable @typescript-eslint/no-explicit-any -- PostgREST client, untyped as in the modules it sits beside */
type Db = any;

/** The SUBMITTED requests among `rows` nobody has started on. Throws on a failed read. */
export async function stillWaiting<T extends { id: string; ap_invoice_id: string | null }>(sb: Db, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return [];
  const billIds = [...new Set(rows.map(r => r.ap_invoice_id).filter((x): x is string => !!x))];
  const [pays, bills] = await Promise.all([
    requestPayments(sb, rows.map(r => r.id)),
    billIds.length ? sb.from('ap_invoices').select('id, status').in('id', billIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (bills.error) throw new Error(bills.error.message);
  const liveBill = new Set(((bills.data ?? []) as Array<{ id: string; status: string }>).filter(b => b.status !== 'CANCELLED').map(b => b.id));
  return rows.filter(r => !(r.ap_invoice_id && liveBill.has(r.ap_invoice_id)) && !(pays.vouchers.get(r.id) ?? []).some(v => v.status !== 'CANCELLED'));
}

/** A claim finance pays back (no float) waits for payment while handed in or checked with no payback voucher. */
export const CLAIM_WAITING_STATUSES = ['HANDED_IN', 'CHECKED'] as const;
