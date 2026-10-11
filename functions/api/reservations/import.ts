import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, upsertGuest, nextBookingRef, holdOnChannels } from '../../_lib/reservations';

/** POST /api/reservations/import { rows: [{ unitNumber, channel, guest, checkIn, checkOut, guestsCount, grossBookingValue, externalRef? }] }
 *  Each row stands alone: a clash or unknown unit rejects that row only. Each booking created closes its nights on the
 *  booking sites (when the unit is linked), so an imported stay cannot be sold twice. A Channex failure does not undo the
 *  booking: it is counted in the answer. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot import reservations.', 403);

  const b = await request.json<any>().catch(() => null);
  if (!Array.isArray(b?.rows) || b.rows.length === 0 || b.rows.length > 100) return fail('VALIDATION', 'Send between 1 and 100 rows.', 422);

  let created = 0;
  const channels = { queued: 0, not_linked: 0, failed: 0 };
  const failed: { row: number; reason: string }[] = [];
  // Every unit named in the file, in one query rather than one per row.
  const numbers = [...new Set(b.rows.map((r: any) => String(r.unitNumber ?? '')))];
  const unitOf = new Map((await all<{ id: string; unit_number: string }>(env,
    'SELECT DISTINCT ON (unit_number) id, unit_number FROM units WHERE unit_number IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY unit_number, id',
    JSON.stringify(numbers))).map(u => [u.unit_number, { id: u.id }]));
  for (const [i, r] of b.rows.entries()) {
    const unit = unitOf.get(String(r.unitNumber ?? ''));
    if (!unit) { failed.push({ row: i + 1, reason: `No unit ${r.unitNumber}.` }); continue; }
    if (!r.checkIn || !r.checkOut || r.checkOut <= r.checkIn) { failed.push({ row: i + 1, reason: 'Check-out must be after check-in.' }); continue; }
    if (!['airbnb', 'booking_com', 'agoda', 'direct'].includes(r.channel)) { failed.push({ row: i + 1, reason: 'Unknown channel.' }); continue; }
    if (await findClash(env, unit.id, r.checkIn, r.checkOut, null)) { failed.push({ row: i + 1, reason: 'Dates already taken.' }); continue; }
    const guestId = r.guest?.fullName ? await upsertGuest(env, r.guest) : null;
    const id = crypto.randomUUID(), now = nowIso();
    const siteRef = typeof r.externalRef === 'string' && r.externalRef.trim() ? r.externalRef.trim().slice(0, 60) : null;
    const ref = r.channel !== 'direct' && siteRef ? siteRef : await nextBookingRef(env, id);
    await run(env, `
      INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'MYR', ?, ?)`,
      id, unit.id, guestId, r.channel, ref, r.checkIn, r.checkOut, r.guestsCount ?? 1, r.grossBookingValue ?? 0, now, now);
    created++;
    channels[await holdOnChannels(env, unit.id, r.checkIn, r.checkOut, false, id)]++;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.import', entityTable: 'reservations', entityId: 'import', after: { created, failed: failed.length, channels } });
  return json({ created, failed, effects: { channels } }, created ? 201 : 200);
};
