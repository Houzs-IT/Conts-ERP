import { type Env, all, one, run, json, fail, audit, nowIso, transaction } from '../../../../_lib/db';
import { can } from '../../../../_lib/access';
import { requireSession } from '../../../../_lib/auth';
import { validatePayment, clean } from '../../../../_lib/bookingPayments';
import { lateCheckoutReady, openLateCheckout, lateBooking, lateRefusal } from '../../../../_lib/lateCheckout';

const rm = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** POST /api/reservations/:id/late-checkout/paid { receivedOn, method?, reference? }
 *  The guest paid for their late checkout: keeps the payment on the request and moves the booking's checkout time,
 *  together in one transaction. The fee is company income, so nothing is written to booking_payments and it never
 *  reaches the booking's money or an owner statement. Money work: it follows the Finance area (functions/_lib/access.ts)
 *  and the same roles as Record payment. Audited. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!can(session, 'finance', 'edit')) return fail('FORBIDDEN', 'Only people who can edit Finance record payments.', 403);
  if (!(await lateCheckoutReady(env))) return fail('NOT_READY', 'Late checkout is not set up on this database yet (migration 0138).', 503);

  const id = String(params.id);
  const open = await openLateCheckout(env, id);
  if (!open) return fail('NOT_FOUND', 'There is no late checkout waiting for payment on this reservation.', 404);
  const b = await request.json<{ receivedOn?: unknown; method?: unknown; reference?: unknown }>().catch(() => null);
  const errs = validatePayment({ amount: open.amount, receivedOn: b?.receivedOn });
  if (errs) return fail('VALIDATION', Object.values(errs)[0], 422, errs);
  const receivedOn = String(b?.receivedOn);
  const method = clean(b?.method, 60);

  const refused = await transaction(env, async tx => {
    // Locked so two people pressing "Guest paid" at once record it once.
    const still = await one<{ id: string }>(tx, `SELECT id FROM late_checkout_requests WHERE id = ? AND status = 'requested' FOR UPDATE`, open.id);
    if (!still) return fail('CONFLICT', 'This late checkout was already paid or cancelled. Reload and look again.', 409);
    const r = await lateBooking(tx, id);
    const no = lateRefusal(r);
    if (no || !r) return no ?? fail('NOT_FOUND', 'That reservation does not exist.', 404);
    const at = nowIso();
    await run(tx, 'UPDATE reservations SET check_out_time = ?, updated_at = ? WHERE id = ?', open.checkoutTime, at, id);
    // Until 26 Oct 2026 a clean was marked "guest out" automatically at the checkout time (stamped in +08:00 form; a
    // staff tap never is). A clean still carrying that mark for the old time loses it: the guest is staying. A tap by
    // staff stays.
    const oldAt = `${r.check_out}T${r.check_out_time || '11:00'}:00+08:00`;
    const unmarked = await all<{ id: string }>(tx, `UPDATE tasks SET guest_left_at = NULL, updated_at = ? WHERE unit_id = ? AND guest_left_at = ? AND state <> 'resolved' RETURNING id`, at, r.unit_id, oldAt);
    if (unmarked.length && r.state === 'checked_in') await run(tx, `UPDATE units SET readiness = 'occupied', updated_at = ? WHERE id = ? AND readiness = 'dirty'`, at, r.unit_id);
    await run(tx, `UPDATE late_checkout_requests SET status = 'paid', paid_on = ?, method = ?, reference = ?, closed_by = ?, closed_at = ? WHERE id = ?`,
      receivedOn, method, clean(b?.reference, 120), session.userId, at, open.id);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.late_checkout_paid', entityTable: 'reservations', entityId: id,
      before: { checkOutTime: r.check_out_time }, after: { requestId: open.id, checkOutTime: open.checkoutTime, amount: open.amount, receivedOn, method, guestOutUnmarked: unmarked.length } });
    return null;
  });
  if (refused) return refused;
  return json({ id: open.id, status: 'paid', checkOutTime: open.checkoutTime, message: `${rm(open.amount)} recorded. Checkout is now by ${open.checkoutTime}.` });
};
