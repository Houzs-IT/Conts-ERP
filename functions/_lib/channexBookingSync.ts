import { syncAvailabilityIfLinked } from './channexSync';
import { bookingAmounts } from './channexAmounts';
import { type Env, one, run, audit, nowIso } from './db';
import { channexConfigured, channexBookingFeed, channexAckBookingRevision, channexChannelFor } from './channex';
import { findClash, upsertGuest } from './reservations';
import { bookingNotice } from './notices';

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
      await markIntegrations(env, 'degraded', `Channex refused the request for new reservations (status ${res.status}).`);
      return { processed: 0, skipped: 0 };
    }
    for (const entry of (res.body?.data ?? []) as FeedEntry[]) {
      const ok = await applyRevision(env, entry).catch(async (e) => {
        await auditSkip(env, entry.id, 'exception', { error: e instanceof Error ? e.message : String(e) });
        return false;
      });
      if (ok) { await channexAckBookingRevision(env, entry.id); processed++; } else skipped++;
    }
    await markIntegrations(env, 'connected', skipped > 0 ? `${skipped} reservation(s) could not be brought in automatically. See History.` : null);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_feed_failed', entityTable: 'reservations', entityId: 'feed', after: { error: message } }).catch(() => {});
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

  const channel = channexChannelFor(a.ota_name);
  if (!channel) return auditSkip(env, entry.id, 'ota_unrecognised', { otaName: a.ota_name });

  const checkIn: string | undefined = room.checkin_date ?? a.arrival_date;
  const checkOut: string | undefined = room.checkout_date ?? a.departure_date;
  if (!checkIn || !checkOut) return auditSkip(env, entry.id, 'missing_dates', a);

  const existing = await one<{ id: string; state: string; unit_id: string; check_in: string; check_out: string }>(env,
    'SELECT id, state, unit_id, check_in, check_out FROM reservations WHERE channex_booking_id = ?', a.booking_id);
  const now = nowIso();

  if (a.status === 'cancelled') {
    if (existing && existing.state !== 'cancelled') {
      await run(env, `UPDATE reservations SET state = 'cancelled', updated_at = ? WHERE id = ?`, now, existing.id);
      await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_cancelled', entityTable: 'reservations', entityId: existing.id, after: { channexBookingId: a.booking_id } });
      // The nights stayed closed on Airbnb after the first live cancellation (8 Oct 2026): nothing told
      // Channex they were free again. Same release a cancellation made here sends.
      await reopen(env, existing.unit_id, existing.check_in, existing.check_out, existing.id);
      await bookingNotice(env, existing.id, 'cancelled', null);
    }
    return true; // nothing local to cancel is not a failure
  }

  const occupancy = a.occupancy ?? room.occupancy ?? {};
  const guestsCount = Math.max(1, Number(occupancy.adults ?? 1) + Number(occupancy.children ?? 0));
  // A booking with no name gets its reference in the placeholder, so nameless guests do not all become one record.
  const ref = a.ota_reservation_code ?? a.unique_id ?? a.booking_id ?? '';
  const guestName = [a.customer?.name, a.customer?.surname].filter(Boolean).join(' ').trim() || `${a.ota_name ?? 'Channel'} guest${ref ? ` ${ref}` : ''}`;
  const guestId = await upsertGuest(env, { fullName: guestName, email: a.customer?.mail ?? null, phone: a.customer?.phone ?? null });
  // Booking value and the site's fee: Channex's amount is the payout on Airbnb (channexAmounts.ts).
  const { grossSen: amountSen, feeSen, source: amountSource } = bookingAmounts(a, room.amount);
  // Owner statements count what the booking site pays out (collected_revenue; functions/_lib/ownerStatement.ts).
  // Only the Host Platform import filled it, so a booking arriving here reached its statement as RM 0.
  const payoutSen = Math.max(0, amountSen - feeSen);

  if (existing) {
    // A modification carries dates, guests and money only. Where the guest is in the stay is ours: a guest already
    // checked in or out stays so (this used to reset them to confirmed); a cancelled booking the site sends again is live.
    await run(env, `UPDATE reservations SET guest_id = ?, check_in = ?, check_out = ?, guests_count = ?, gross_booking_value = ?, channel_fee = ?, collected_revenue = ?, currency = ?,
      state = CASE WHEN state IN ('checked_in','checked_out','no_show') THEN state ELSE 'confirmed' END, updated_at = ? WHERE id = ?`,
      guestId, checkIn, checkOut, guestsCount, amountSen, feeSen, payoutSen, a.currency ?? 'MYR', now, existing.id);
    // A changed stay frees the nights it left and takes the ones it moved to.
    if (existing.check_in !== checkIn || existing.check_out !== checkOut || existing.state === 'cancelled') {
      if (existing.state !== 'cancelled') await reopen(env, unit.id, existing.check_in, existing.check_out, existing.id);
      await syncAvailabilityIfLinked(env, unit.id, checkIn, checkOut, false);
    }
    const clash = await findClash(env, unit.id, checkIn, checkOut, existing.id);
    if (clash) await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_clash', entityTable: 'reservations', entityId: existing.id, after: { checkIn, checkOut, clashingReservationId: clash.id, otaBookingId: a.booking_id } });
    const moved = existing.check_in !== checkIn || existing.check_out !== checkOut;
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_updated', entityTable: 'reservations', entityId: existing.id,
      before: moved ? { checkIn: existing.check_in, checkOut: existing.check_out } : undefined,
      after: { channexBookingId: a.booking_id, ...(moved ? { checkIn, checkOut } : {}) } });
    if (moved) await bookingNotice(env, existing.id, 'dates', null, { from: { checkIn: existing.check_in, checkOut: existing.check_out } });
    return true;
  }

  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO reservations (id, unit_id, guest_id, channel, external_ref, channex_booking_id, state, check_in, check_out, guests_count, gross_booking_value, channel_fee, collected_revenue, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, unit.id, guestId, channel, a.ota_reservation_code ?? a.unique_id ?? null, a.booking_id,
    checkIn, checkOut, guestsCount, amountSen, feeSen, payoutSen, a.currency ?? 'MYR', now, now);
  // Taken here, so closed on every booking site this unit is sold on.
  await syncAvailabilityIfLinked(env, unit.id, checkIn, checkOut, false);
  const clash = await findClash(env, unit.id, checkIn, checkOut, id);
  if (clash) await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_clash', entityTable: 'reservations', entityId: id, after: { checkIn, checkOut, clashingReservationId: clash.id, otaBookingId: a.booking_id } });
  await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_created', entityTable: 'reservations', entityId: id, after: { channexBookingId: a.booking_id, otaName: a.ota_name, grossSen: amountSen, feeSen, amountSource, unitId: unit.id, checkIn, checkOut } });
  await bookingNotice(env, id, 'created', null);
  return true;
}

/** Tells the booking sites the nights are free again, unless another stay still holds them. */
async function reopen(env: Env, unitId: string, checkIn: string, checkOut: string, exceptId: string) {
  if (await findClash(env, unitId, checkIn, checkOut, exceptId)) return;
  await syncAvailabilityIfLinked(env, unitId, checkIn, checkOut, true);
}

async function auditSkip(env: Env, revisionId: string, reason: string, details: unknown): Promise<false> {
  await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.booking_skipped', entityTable: 'reservations', entityId: revisionId, after: { reason, details } }).catch(() => {});
  return false;
}
