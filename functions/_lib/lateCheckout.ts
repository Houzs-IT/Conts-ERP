import { type Env, one, fail } from './db';

/** Paid late checkout (migration 0138): a request with a new time, a fee and a remark, which moves the booking's checkout
 *  time only once the guest has paid. The fee is company income: it never enters booking_payments or an owner statement. */

export interface LateCheckout {
  id: string; checkoutTime: string; amount: number; remark: string | null;
  status: 'requested' | 'paid' | 'cancelled'; requestedBy: string | null; requestedAt: string;
}

/** Whether migration 0138 is applied. Remembered once it is, so a panel stops paying a catalogue query. */
let seen = false;
export async function lateCheckoutReady(env: Env): Promise<boolean> {
  if (seen) return true;
  const r = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_name = 'late_checkout_requests' AND table_schema = ANY(current_schemas(false))`);
  seen = Number(r?.n ?? 0) === 1;
  return seen;
}

/** The booking's open (unpaid) request, if any. */
export async function openLateCheckout(env: Env, reservationId: string): Promise<LateCheckout | null> {
  if (!(await lateCheckoutReady(env))) return null;
  const r = await one<{ id: string; checkout_time: string; amount: number; remark: string | null; status: LateCheckout['status']; requested_by_name: string | null; requested_at: string }>(env, `
    SELECT l.id, l.checkout_time, l.amount, l.remark, l.status, u.full_name AS requested_by_name, l.requested_at
    FROM late_checkout_requests l LEFT JOIN users u ON u.id = l.requested_by
    WHERE l.reservation_id = ? AND l.status = 'requested'`, reservationId);
  return r ? { id: r.id, checkoutTime: r.checkout_time, amount: Number(r.amount), remark: r.remark, status: r.status, requestedBy: r.requested_by_name, requestedAt: r.requested_at } : null;
}

const DONE = ['checked_out', 'cancelled', 'no_show'];
export interface LateBooking { id: string; unit_id: string; state: string; channel: string; check_out: string; check_out_time: string | null }
export const lateBooking = (env: Env, id: string): Promise<LateBooking | null> =>
  one<LateBooking>(env, 'SELECT id, unit_id, state, channel, check_out, check_out_time FROM reservations WHERE id = ?', id);
/** Why this booking cannot get a late checkout, or null. */
export const lateRefusal = (r: LateBooking | null): Response | null => !r ? fail('NOT_FOUND', 'That reservation does not exist.', 404)
  : r.channel === 'maintenance_block' || r.channel === 'owner_stay' ? fail('VALIDATION', 'Blocks and owner stays have no checkout to extend.', 422)
  : DONE.includes(r.state) ? fail('CONFLICT', 'A past, cancelled or no-show reservation cannot get a late checkout.', 409)
  : null;
