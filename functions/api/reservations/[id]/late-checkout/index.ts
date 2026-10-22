import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession, isFieldRole } from '../../../../_lib/auth';
import { clean } from '../../../../_lib/bookingPayments';
import { MONEY_ROLES } from '../../../../_lib/bookingMoney';
import { lateCheckoutReady, openLateCheckout, lateBooking, lateRefusal } from '../../../../_lib/lateCheckout';
import { LIVE_STAY_SQL } from '../../../../_lib/cleaning';
import { checkSen } from '../../../../_lib/validate';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** GET /api/reservations/:id/late-checkout — what the late checkout block on the cleaning job and the reservation shows:
 *  the booking's checkout, its open request, and what this user may do. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);
  const id = String(params.id);
  const r = await lateBooking(env, id);
  if (!r) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  const ready = await lateCheckoutReady(env);
  return json({
    checkOut: r.check_out, checkOutTime: r.check_out_time || '11:00',
    open: await openLateCheckout(env, id),
    canRequest: ready && !lateRefusal(r),
    canPay: ready && MONEY_ROLES.includes(session.role),
  });
};

/** POST /api/reservations/:id/late-checkout { checkoutTime, amount (sen), remark? }
 *  Records a guest's request to check out later for a fee. The booking's checkout time does not change yet: it changes
 *  when the request is marked paid (./paid). One open request per booking. Audited. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);
  if (!(await lateCheckoutReady(env))) return fail('NOT_READY', 'Late checkout is not set up on this database yet (migration 0138).', 503);

  const id = String(params.id);
  const r = await lateBooking(env, id);
  const no = lateRefusal(r);
  if (no || !r) return no ?? fail('NOT_FOUND', 'That reservation does not exist.', 404);

  const b = await request.json<{ checkoutTime?: unknown; amount?: unknown; remark?: unknown }>().catch(() => null);
  const errs: Record<string, string> = {};
  const time = typeof b?.checkoutTime === 'string' ? b.checkoutTime : '';
  const now = r.check_out_time || '11:00';
  if (!TIME.test(time)) errs.checkoutTime = 'Use HH:MM, e.g. 14:00.';
  else if (time <= now) errs.checkoutTime = `Pick a time after the current checkout, ${now}.`;
  checkSen(errs, 'amount', b?.amount, { label: 'Amount', required: true, min: 1, max: 100_000_000 });
  if (Object.keys(errs).length) return fail('VALIDATION', Object.values(errs)[0], 422, errs);

  // The next guest arriving that same day must still find the unit empty and cleaned.
  const next = await one<{ check_in_time: string | null }>(env, `SELECT x.check_in_time FROM reservations x
    WHERE x.unit_id = ? AND x.check_in = ? AND x.id != ? AND ${LIVE_STAY_SQL('x')} ORDER BY x.check_in_time LIMIT 1`, r.unit_id, r.check_out, id);
  const arrive = next ? next.check_in_time || '15:00' : null;
  if (arrive && time >= arrive) {
    const msg = `The next guest checks in at ${arrive} that day. Pick an earlier time.`;
    return fail('CONFLICT', msg, 409, { checkoutTime: msg });
  }

  const amount = Number(b?.amount);
  const remark = clean(b?.remark, 500);
  const lid = crypto.randomUUID();
  try {
    await run(env, `INSERT INTO late_checkout_requests (id, reservation_id, checkout_time, amount, remark, status, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, 'requested', ?, ?)`, lid, id, time, amount, remark, session.userId, nowIso());
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === '23505') return fail('CONFLICT', 'This reservation already has a late checkout waiting for payment. Cancel it first to change it.', 409);
    throw e;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.late_checkout', entityTable: 'reservations', entityId: id,
    after: { requestId: lid, checkoutTime: time, from: now, amount, remark } });
  return json(await openLateCheckout(env, id), 201);
};

/** DELETE /api/reservations/:id/late-checkout — cancels the open request. Nothing was charged and the checkout time never
 *  moved, so there is nothing to undo. The row stays (status cancelled) and the cancellation is audited. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot change reservations.', 403);
  if (!(await lateCheckoutReady(env))) return fail('NOT_READY', 'Late checkout is not set up on this database yet (migration 0138).', 503);

  const id = String(params.id);
  const open = await openLateCheckout(env, id);
  if (!open) return fail('NOT_FOUND', 'There is no late checkout waiting for payment on this reservation.', 404);
  await run(env, `UPDATE late_checkout_requests SET status = 'cancelled', closed_by = ?, closed_at = ? WHERE id = ? AND status = 'requested'`, session.userId, nowIso(), open.id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.late_checkout_cancelled', entityTable: 'reservations', entityId: id,
    before: { requestId: open.id, checkoutTime: open.checkoutTime, amount: open.amount } });
  return json({ id: open.id, status: 'cancelled' });
};
