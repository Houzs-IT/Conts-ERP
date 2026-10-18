import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { findClash, upsertGuest, nextBookingRef, holdOnChannels, withUnitLock } from '../../_lib/reservations';
import { checkDate, checkInt, checkSen, type Fields } from '../../_lib/validate';
import { ensureTurnovers } from '../../_lib/cleaning';

/** POST /api/reservations/import { rows: [{ unitNumber, channel, guest, checkIn, checkOut, guestsCount, grossBookingValue, externalRef? }] }
 *  Each row stands alone: a clash or unknown unit rejects that row only. Each booking created closes its nights on the
 *  booking sites (when the unit is linked), so an imported stay cannot be sold twice. A Channex failure does not undo the
 *  booking: it is counted in the answer. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot import reservations.', 403);

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
  const madeIds: string[] = [];
  for (const [i, r] of b.rows.entries()) {
    const unit = unitOf.get(String(r.unitNumber ?? ''));
    if (!unit) { failed.push({ row: i + 1, reason: `No unit ${r.unitNumber}.` }); continue; }
    // A row that is not a real date or amount would be stored as text and break every report that reads its dates.
    const fields: Fields = {};
    checkDate(fields, 'checkIn', r.checkIn, { label: 'Check-in', required: true });
    checkDate(fields, 'checkOut', r.checkOut, { label: 'Checkout', required: true });
    checkInt(fields, 'guestsCount', r.guestsCount, { label: 'Guests', min: 0, max: 50 });
    checkSen(fields, 'grossBookingValue', r.grossBookingValue, { label: 'Rate' });
    const why = Object.values(fields)[0];
    if (why) { failed.push({ row: i + 1, reason: why }); continue; }
    if (r.checkOut <= r.checkIn) { failed.push({ row: i + 1, reason: 'Checkout must be after check-in.' }); continue; }
    if (!['airbnb', 'booking_com', 'agoda', 'direct'].includes(r.channel)) { failed.push({ row: i + 1, reason: 'Unknown channel.' }); continue; }
    const id = crypto.randomUUID(), now = nowIso();
    const siteRef = typeof r.externalRef === 'string' && r.externalRef.trim() ? r.externalRef.trim().slice(0, 60) : null;
    const ok = await withUnitLock(env, unit.id, async tx => {
      if (await findClash(tx, unit.id, r.checkIn, r.checkOut, null)) return false;
      const guestId = r.guest?.fullName ? await upsertGuest(tx, r.guest) : null;
      const ref = r.channel !== 'direct' && siteRef ? siteRef : await nextBookingRef(tx, id);
      await run(tx, `
        INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 'MYR', ?, ?)`,
        id, unit.id, guestId, r.channel, ref, r.checkIn, r.checkOut, r.guestsCount ?? 1, r.grossBookingValue ?? 0, now, now);
      return true;
    });
    if (!ok) { failed.push({ row: i + 1, reason: 'Dates already taken.' }); continue; }
    created++;
    madeIds.push(id);
    channels[await holdOnChannels(env, unit.id, r.checkIn, r.checkOut, false, id)]++;
  }
  await ensureTurnovers(env, { reservationIds: madeIds });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reservation.import', entityTable: 'reservations', entityId: 'import', after: { created, failed: failed.length, channels } });
  return json({ created, failed, effects: { channels } }, created ? 201 : 200);
};
