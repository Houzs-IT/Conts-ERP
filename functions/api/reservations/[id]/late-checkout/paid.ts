import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { MONEY_ROLES, moneySchema } from '../../../../_lib/bookingMoney';
import { validatePayment, insertPayment, clean } from '../../../../_lib/bookingPayments';
import { lateCheckoutReady, openLateCheckout, lateCheckoutNote, lateBooking, lateRefusal } from '../../../../_lib/lateCheckout';

const rm = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** POST /api/reservations/:id/late-checkout/paid { receivedOn, method?, reference? }
 *  The guest paid for their late checkout: records the fee as a guest payment and moves the booking's checkout time,
 *  together in one transaction. Money work, so it follows the Finance area (functions/_lib/access.ts) and the same roles
 *  as Record payment. Audited. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can record payments.', 403);
  if (!(await lateCheckoutReady(env))) return fail('NOT_READY', 'Late checkout is not set up on this database yet (migration 0138).', 503);
  if (!(await moneySchema(env)).payments) return fail('NOT_READY', 'Payments are not set up on this database yet (migration 0091).', 503);

  const id = String(params.id);
  const open = await openLateCheckout(env, id);
  if (!open) return fail('NOT_FOUND', 'There is no late checkout waiting for payment on this reservation.', 404);
  const b = await request.json<{ receivedOn?: unknown; method?: unknown; reference?: unknown }>().catch(() => null);
  const errs = validatePayment({ amount: open.amount, receivedOn: b?.receivedOn, kind: 'guest_payment' });
  if (errs) return fail('VALIDATION', Object.values(errs)[0], 422, errs);
  const receivedOn = String(b?.receivedOn);

  const refused = await transaction(env, async tx => {
    // Locked so two people pressing "Guest paid" at once record the fee once.
    const still = await one<{ id: string }>(tx, `SELECT id FROM late_checkout_requests WHERE id = ? AND status = 'requested' FOR UPDATE`, open.id);
    if (!still) return fail('CONFLICT', 'This late checkout was already paid or cancelled. Reload the reservation.', 409);
    const r = await lateBooking(tx, id);
    const no = lateRefusal(r);
    if (no || !r) return no ?? fail('NOT_FOUND', 'That reservation does not exist.', 404);
    const p = await insertPayment(tx, { reservationId: id, amount: open.amount, receivedOn, method: clean(b?.method, 60), reference: clean(b?.reference, 120),
      kind: 'guest_payment', note: lateCheckoutNote(open.checkoutTime, open.remark), userId: session.userId });
    const at = nowIso();
    await run(tx, 'UPDATE reservations SET check_out_time = ?, updated_at = ? WHERE id = ?', open.checkoutTime, at, id);
    await run(tx, `UPDATE late_checkout_requests SET status = 'paid', payment_id = ?, closed_by = ?, closed_at = ? WHERE id = ?`, p.id, session.userId, at, open.id);
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.late_checkout_paid', entityTable: 'reservations', entityId: id,
      before: { checkOutTime: r.check_out_time }, after: { requestId: open.id, checkOutTime: open.checkoutTime, paymentId: p.id, amount: open.amount, receivedOn, method: p.method } });
    return null;
  });
  if (refused) return refused;
  return json({ id: open.id, status: 'paid', checkOutTime: open.checkoutTime, message: `${rm(open.amount)} recorded. Checkout is now by ${open.checkoutTime}.` });
};
