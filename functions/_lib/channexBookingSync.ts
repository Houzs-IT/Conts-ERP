import { type Env, one, run, audit, nowIso } from './db';
import { channexConfigured, channexBookingFeed, channexAckBookingRevision } from './channex';
import { findClash, upsertGuest } from './reservations';

/** Only OTAs the owner has actually connected map to a channel. An OTA name Channex sends that
 *  isn't listed here is left un-acked (see below) rather than guessed at. */
const CHANNEL_BY_OTA: Record<string, string> = {
  airbnb: 'airbnb',
  'booking.com': 'booking_com',
  agoda: 'agoda',
};

interface FeedEntry { id: string; attributes: Record<string, any> }

/** All three show as one connection: Channex is a single account covering all of them, so one
 *  feed pull answers for all three, and a person reading the Integrations screen should see one
 *  consistent status rather than three that drift apart. */
const OTA_PROVIDERS = ['airbnb', 'booking_com', 'agoda'];

/** Pulls every booking revision Channex has not seen us acknowledge, and turns each into a
 *  reservation (or updates/cancels the one already linked to it). Only a revision this could
 *  actually apply is acknowledged — one it can't (unmapped unit, unrecognised OTA, missing
 *  dates) is left in the feed on purpose, so it keeps reappearing, and keeps a trail in the
 *  audit log, until a person fixes the mapping. Never throws: called from a webhook request
 *  that must still answer 200, and from a manual "sync now" retry.
 *  https://docs.channex.io/api-v.1-documentation/bookings-collection */
export async function processChannexBookingFeed(env: Env): Promise<{ processed: number; skipped: number }> {
  if (!channexConfigured(env)) return { processed: 0, skipped: 0 };
  let processed = 0, skipped = 0;
  try {
    const res = await channexBookingFeed(env);
    if (!res.ok) {
      await markIntegrations(env, 'degraded', `Channex refused the booking feed (status ${res.status}).`);
      return { processed: 0, skipped: 0 };
    }
    for (const entry of (res.body?.data ?? []) as FeedEntry[]) {
      const ok = await applyRevision(env, entry).catch(async (e) => {
        await auditSkip(env, entry.id, 'exception', { error: e instanceof Error ? e.message : String(e) });
        return false;
      });
      if (ok) { await channexAckBookingRevision(env, entry.id); processed++; } else skipped++;
    }
    await markIntegrations(env, 'connected', skipped > 0 ? `${skipped} booking(s) could not be matched automatically — see the audit log.` : null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_feed_failed', entityTable: 'reservations', entityId: 'feed', after: { error: message } }).catch(() => {});
    await markIntegrations(env, 'degraded', message);
  }
  return { processed, skipped };
}

async function markIntegrations(env: Env, state: 'connected' | 'degraded', lastError: string | null) {
  await run(env, `UPDATE integrations SET state = ?, last_synced_at = ?, last_error = ? WHERE provider IN (?, ?, ?)`,
    state, nowIso(), lastError, ...OTA_PROVIDERS).catch(() => {});
}

async function applyRevision(env: Env, entry: FeedEntry): Promise<boolean> {
  const a = entry.attributes ?? {};
  const room = (a.rooms ?? [])[0];
  if (!room) return auditSkip(env, entry.id, 'no_room', a);

  const unit = await one<{ id: string }>(env,
    'SELECT id FROM units WHERE channex_property_id = ? AND channex_room_type_id = ?', a.property_id, room.room_type_id);
  if (!unit) return auditSkip(env, entry.id, 'unit_unmapped', { propertyId: a.property_id, roomTypeId: room.room_type_id });

  const channel = CHANNEL_BY_OTA[String(a.ota_name ?? '').trim().toLowerCase()];
  if (!channel) return auditSkip(env, entry.id, 'ota_unrecognised', { otaName: a.ota_name });

  const checkIn: string | undefined = room.checkin_date ?? a.arrival_date;
  const checkOut: string | undefined = room.checkout_date ?? a.departure_date;
  if (!checkIn || !checkOut) return auditSkip(env, entry.id, 'missing_dates', a);

  const existing = await one<{ id: string; state: string }>(env, 'SELECT id, state FROM reservations WHERE channex_booking_id = ?', a.booking_id);
  const now = nowIso();

  if (a.status === 'cancelled') {
    if (existing && existing.state !== 'cancelled') {
      await run(env, `UPDATE reservations SET state = 'cancelled', updated_at = ? WHERE id = ?`, now, existing.id);
      await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_cancelled', entityTable: 'reservations', entityId: existing.id, after: { channexBookingId: a.booking_id } });
    }
    return true; // nothing local to cancel is not a failure
  }

  const occupancy = a.occupancy ?? room.occupancy ?? {};
  const guestsCount = Math.max(1, Number(occupancy.adults ?? 1) + Number(occupancy.children ?? 0));
  const guestName = [a.customer?.name, a.customer?.surname].filter(Boolean).join(' ').trim() || `${a.ota_name ?? 'OTA'} guest`;
  const guestId = await upsertGuest(env, { fullName: guestName, email: a.customer?.mail ?? null, phone: a.customer?.phone ?? null });
  const amountSen = Math.round(Number(a.amount ?? room.amount ?? 0) * 100);

  if (existing) {
    await run(env, `UPDATE reservations SET guest_id = ?, check_in = ?, check_out = ?, guests_count = ?, gross_booking_value = ?, currency = ?, state = 'confirmed', updated_at = ? WHERE id = ?`,
      guestId, checkIn, checkOut, guestsCount, amountSen, a.currency ?? 'MYR', now, existing.id);
    const clash = await findClash(env, unit.id, checkIn, checkOut, existing.id);
    if (clash) await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_clash', entityTable: 'reservations', entityId: existing.id, after: { checkIn, checkOut, clashingReservationId: clash.id, otaBookingId: a.booking_id } });
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_updated', entityTable: 'reservations', entityId: existing.id, after: { channexBookingId: a.booking_id } });
    return true;
  }

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, channex_booking_id, state, check_in, check_out, guests_count, gross_booking_value, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)`,
    id, unit.id, guestId, channel, a.ota_reservation_code ?? a.unique_id ?? null, a.booking_id,
    checkIn, checkOut, guestsCount, amountSen, a.currency ?? 'MYR', now, now);
  const clash = await findClash(env, unit.id, checkIn, checkOut, id);
  if (clash) await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_clash', entityTable: 'reservations', entityId: id, after: { checkIn, checkOut, clashingReservationId: clash.id, otaBookingId: a.booking_id } });
  await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_created', entityTable: 'reservations', entityId: id, after: { channexBookingId: a.booking_id, otaName: a.ota_name, unitId: unit.id, checkIn, checkOut } });
  return true;
}

async function auditSkip(env: Env, revisionId: string, reason: string, details: unknown): Promise<false> {
  await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.booking_skipped', entityTable: 'reservations', entityId: revisionId, after: { reason, details } }).catch(() => {});
  return false;
}
