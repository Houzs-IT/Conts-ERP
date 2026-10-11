import { type Env, all, one, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { moneySchema, moneySql, toPayment, MONEY_ROLES, OTA_CHANNELS } from '../../../_lib/bookingMoney';
import { validatePayment, insertPayment, clean } from '../../../_lib/bookingPayments';
import { approvalsEnabled, submit } from '../../../_lib/approvals';

/** GET /api/reservations/:id/payments — the money received against one booking, oldest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can see payments.', 403);
  if (!(await moneySchema(env)).payments) return fail('NOT_READY', 'Payments are not set up on this database yet (migration 0091).', 503);
  const rows = await all<any>(env, `
    SELECT bp.*, u.full_name AS created_by_name FROM booking_payments bp LEFT JOIN users u ON u.id = bp.created_by
    WHERE bp.reservation_id = ? ORDER BY bp.status = 'expected', COALESCE(bp.received_on, '9999'), bp.created_at, bp.id`, String(params.id));
  return json({ data: rows.map(toPayment) });
};

/** POST /api/reservations/:id/payments { amount (sen), receivedOn, method?, reference?, kind?, note? }
 *  Records money received: a guest paying a direct booking, a booking site's payout, or a refund going back.
 *  The booking leaves "Direct unpaid" / "Payout pending" once nothing is outstanding. Audited. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can record payments.', 403);
  const schema = await moneySchema(env);
  if (!schema.payments) return fail('NOT_READY', 'Payments are not set up on this database yet (migration 0091).', 503);

  const id = String(params.id);
  const r = await one<{ id: string; channel: string; state: string; external_ref: string | null }>(env, 'SELECT id, channel, state, external_ref FROM reservations WHERE id = ?', id);
  if (!r) return fail('NOT_FOUND', 'That reservation does not exist.', 404);
  if (r.channel === 'maintenance_block' || r.channel === 'owner_stay') return fail('VALIDATION', 'Blocks and owner stays take no payments.', 422);

  const b = await request.json<any>().catch(() => null);
  const errs = validatePayment(b);
  if (errs) return fail('VALIDATION', Object.values(errs)[0], 422, errs);
  const kind = b.kind ?? (OTA_CHANNELS.includes(r.channel) ? 'ota_payout' : 'guest_payment');
  if (kind === 'refund') {
    // A refund gives back money we hold: more than was received would leave the booking below zero.
    const m = moneySql(schema);
    const got = await one<{ received: number }>(env, `SELECT ${m.received} AS received FROM reservations r ${m.join} WHERE r.id = ?`, id);
    const held = Math.max(Number(got?.received ?? 0), 0);
    if (Math.round(Number(b.amount)) > held) {
      const msg = held > 0 ? `A refund can be at most what was received: RM ${(held / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })}.` : 'Nothing has been received on this reservation, so there is nothing to refund.';
      return fail('VALIDATION', msg, 422, { amount: msg });
    }
    // With approvals on, money going back to a guest waits for a second person (functions/_lib/approvals.ts), and the
    // reason goes to them. Off, the approval executor records the refund at once.
    const on = await approvalsEnabled(env);
    const reason = clean(b.reason, 500) ?? clean(b.note, 500) ?? (on ? null : 'Refund');
    if (!reason) return fail('VALIDATION', 'Say why the guest is refunded. It goes to the person who approves it.', 422, { reason: 'Say why the guest is refunded.' });
    const amount = Math.round(Number(b.amount));
    return submit(env, session, {
      kind: 'guest_refund', entity: 'reservations', entityId: id, amount, reason,
      summary: `Refund RM ${(amount / 100).toLocaleString('en-MY', { minimumFractionDigits: 2 })} to the guest of ${r.external_ref ?? 'reservation ' + id}`,
      payload: { reservationId: id, amount, receivedOn: b.receivedOn, method: clean(b.method, 60), reference: clean(b.reference, 120), note: clean(b.note, 500) },
    }, res => json({ id: res.paymentId, kind: 'refund', amount }, 201));
  }
  const p = await insertPayment(env, { reservationId: id, amount: Math.round(Number(b.amount)), receivedOn: b.receivedOn, method: clean(b.method, 60), reference: clean(b.reference, 120), kind, note: clean(b.note, 500), userId: session.userId });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.payment', entityTable: 'reservations', entityId: id,
    after: { paymentId: p.id, amount: p.amount, kind, receivedOn: b.receivedOn, method: p.method, reference: p.reference } });
  return json(p, 201);
};

