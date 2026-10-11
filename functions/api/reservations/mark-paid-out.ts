import { type Env, all, json, fail, transaction } from '../../_lib/db';
import { auditMany } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { moneySchema, moneySql, MONEY_ROLES } from '../../_lib/bookingMoney';
import { insertPayments, clean } from '../../_lib/bookingPayments';
import { checkDate, invalid, type Fields } from '../../_lib/validate';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** POST /api/reservations/mark-paid-out { ids: string[], receivedOn, reference? }
 *  "Mark payouts received" for bookings picked on the Payout pending card: each booking-site booking gets one payout
 *  for what it still had outstanding, so it leaves the card. A booking that is not a booking-site booking, is
 *  cancelled, or owes nothing is left alone and named in the answer. One audit row per booking. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MONEY_ROLES.includes(session.role)) return fail('FORBIDDEN', 'Only management, finance and operations managers can record host payouts.', 403);
  const schema = await moneySchema(env);
  if (!schema.payments) return fail('NOT_READY', 'Payments are not set up on this database yet (migration 0091).', 503);

  const b = await request.json<any>().catch(() => null);
  const ids = Array.isArray(b?.ids) ? [...new Set(b.ids.filter((x: unknown) => typeof x === 'string'))] as string[] : [];
  if (!ids.length || ids.length > 500) return fail('VALIDATION', 'Pick between 1 and 500 reservations.', 422);
  if (!b.receivedOn || !ISO_DAY.test(b.receivedOn)) return fail('VALIDATION', 'Pick the date the host payout arrived.', 422, { receivedOn: 'Pick the date the host payout arrived.' });
  if (b.receivedOn > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) return fail('VALIDATION', 'The date cannot be in the future.', 422, { receivedOn: 'The date cannot be in the future.' });
  const fields: Fields = {};
  checkDate(fields, 'receivedOn', b.receivedOn, { label: 'Arrived on', required: true });
  const bad = invalid(fields); if (bad) return bad;

  const m = moneySql(schema);
  const rows = await all<{ id: string; external_ref: string | null; channel: string; state: string; outstanding: number }>(env, `
    SELECT r.id, r.external_ref, r.channel, r.state, ${m.outstanding} AS outstanding
    FROM reservations r ${m.join}
    WHERE r.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(ids));
  const byId = new Map(rows.map(r => [r.id, r]));
  const reference = clean(b.reference, 120);
  let recorded = 0, total = 0;
  const skipped: { id: string; ref: string | null; reason: string }[] = [];
  const pay: { reservationId: string; amount: number }[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) { skipped.push({ id, ref: null, reason: 'Not found.' }); continue; }
    if (!['airbnb', 'booking_com', 'agoda'].includes(r.channel)) { skipped.push({ id, ref: r.external_ref, reason: 'Not from Airbnb, Booking.com or Agoda.' }); continue; }
    if (r.state === 'cancelled' || r.state === 'no_show') { skipped.push({ id, ref: r.external_ref, reason: 'Cancelled or no-show.' }); continue; }
    const owed = Number(r.outstanding);
    if (!(owed > 0)) { skipped.push({ id, ref: r.external_ref, reason: 'Nothing outstanding.' }); continue; }
    pay.push({ reservationId: id, amount: owed });
    recorded++; total += owed;
  }
  // Every payout and its audit row land together, or none of them does.
  await transaction(env, async tx => {
    const made = await insertPayments(tx, pay.map(p => ({ ...p, receivedOn: b.receivedOn, method: 'Booking site payout', reference, kind: 'ota_payout', note: 'Marked received in bulk', userId: session.userId })));
    await auditMany(tx, made.map((p, i) => ({ actorId: session.userId, actorLabel: session.fullName, action: 'reservation.payment', entityTable: 'reservations', entityId: pay[i].reservationId,
      after: { paymentId: p.id, amount: pay[i].amount, kind: 'ota_payout', receivedOn: b.receivedOn, reference, bulk: true } })));
  });
  return json({ recorded, total, skipped });
};
