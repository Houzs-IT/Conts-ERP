import { type Env, one, run, audit, nowIso } from './db';
import { channexConfigured, channexChannelFor, channexMessageThreads, channexThreadMessages, channexReviews, channexSendMessage, channexReplyToReview } from './channex';

export interface ChannexDelivery { state: 'sent' | 'not_linked'; reason?: string }

/** Sends a staff reply out to the guest on Airbnb or Booking.com's own messaging system. A thread
 *  only has a channex_thread_id if it came from Channex in the first place — that already rules
 *  out Agoda (Channex has no Messages API for it) and every local-only thread (direct/WhatsApp),
 *  so no separate channel check is needed. Never throws: a guest reply must always save locally
 *  even if the push to the channel fails, same rule as every other Channex sync in this app —
 *  the caller gets a status back to show the user, but the local save already happened either
 *  way. Saves the OTA's own message id onto the local row so a later pull recognises this message
 *  and does not import it again as a duplicate inbound copy. */
export async function pushMessageIfLinked(env: Env, threadId: string, localMessageId: string, body: string): Promise<ChannexDelivery> {
  try {
    if (!channexConfigured(env)) return { state: 'not_linked' };
    const thread = await one<{ channex_thread_id: string | null }>(env, 'SELECT channex_thread_id FROM message_threads WHERE id = ?', threadId);
    if (!thread?.channex_thread_id) return { state: 'not_linked' };
    const res = await channexSendMessage(env, thread.channex_thread_id, body);
    if (res.ok && res.body?.data?.id) {
      await run(env, 'UPDATE messages SET channex_message_id = ? WHERE id = ?', res.body.data.id, localMessageId);
      return { state: 'sent' };
    }
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.message_push_failed', entityTable: 'messages', entityId: localMessageId, after: { status: res.status } });
    return { state: 'not_linked', reason: `Channex refused the message (status ${res.status}).` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.message_push_failed', entityTable: 'messages', entityId: localMessageId, after: { error: message } }).catch(() => {});
    return { state: 'not_linked', reason: message };
  }
}

/** Same idea for a host's reply to a review. */
export async function pushReviewReplyIfLinked(env: Env, reviewId: string, reply: string): Promise<void> {
  try {
    if (!channexConfigured(env)) return;
    const review = await one<{ channex_review_id: string | null }>(env, 'SELECT channex_review_id FROM reviews WHERE id = ?', reviewId);
    if (!review?.channex_review_id) return;
    const res = await channexReplyToReview(env, review.channex_review_id, reply);
    if (!res.ok) await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.review_reply_push_failed', entityTable: 'reviews', entityId: reviewId, after: { status: res.status } });
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.review_reply_push_failed', entityTable: 'reviews', entityId: reviewId, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
  }
}

/** A thread or review only matters here once it is tied to a reservation we recognise — that is
 *  how the unit, guest and channel get filled in without guessing. One with no booking behind it
 *  (an Airbnb pre-booking inquiry, say) is left alone and logged, same discipline as an unmapped
 *  booking in channexBookingSync.ts. */
async function reservationFor(env: Env, channexBookingId: string | null | undefined) {
  if (!channexBookingId) return null;
  return one<{ id: string; unit_id: string; guest_id: string | null }>(env,
    'SELECT id, unit_id, guest_id FROM reservations WHERE channex_booking_id = ?', channexBookingId);
}

/** Pulls new guest messages and reviews from Channex. Unlike bookings there is no
 *  acknowledge-the-feed mechanism for these two — Channex's own docs list no such thing for
 *  message_threads or reviews — so "already seen" is tracked on our side, by the OTA's own id
 *  (channex_message_id / channex_review_id) being unique. Never throws, for the same reasons as
 *  processChannexBookingFeed: called from a webhook that must answer 200 either way, and from a
 *  manual "sync now" retry. */
export async function processChannexMessagesAndReviews(env: Env): Promise<{ messages: number; reviews: number }> {
  if (!channexConfigured(env)) return { messages: 0, reviews: 0 };
  const messages = await pullMessages(env).catch(async (e) => {
    await auditFail(env, 'channex.message_sync_failed', e);
    return 0;
  });
  const reviews = await pullReviews(env).catch(async (e) => {
    await auditFail(env, 'channex.review_sync_failed', e);
    return 0;
  });
  return { messages, reviews };
}

async function pullMessages(env: Env): Promise<number> {
  const res = await channexMessageThreads(env);
  if (!res.ok) { await auditFail(env, 'channex.message_sync_failed', new Error(`status ${res.status}`)); return 0; }

  let imported = 0;
  for (const thread of (res.body?.data ?? []) as any[]) {
    const a = thread.attributes ?? {};
    const channexBookingId: string | null = thread.relationships?.booking?.data?.id ?? null;
    const reservation = await reservationFor(env, channexBookingId);
    if (!reservation) { await auditSkip(env, 'message_thread', thread.id, 'no_matching_reservation', { channexBookingId }); continue; }

    const channel = channexChannelFor(a.provider);
    if (!channel) { await auditSkip(env, 'message_thread', thread.id, 'ota_unrecognised', { provider: a.provider }); continue; }

    let local = await one<{ id: string }>(env, 'SELECT id FROM message_threads WHERE channex_thread_id = ?', thread.id);
    if (!local) {
      const id = crypto.randomUUID();
      await run(env, `
        INSERT INTO message_threads (id, reservation_id, guest_id, channel, subject, channex_thread_id, is_read, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        id, reservation.id, reservation.guest_id, channel, a.title ?? 'Stay', thread.id, a.last_message_received_at ?? nowIso());
      local = { id };
    }

    const msgRes = await channexThreadMessages(env, thread.id);
    if (!msgRes.ok) continue;
    let latestSentAt: string | null = null;
    let sawNewInbound = false;
    for (const m of (msgRes.body?.data ?? []) as any[]) {
      const already = await one(env, 'SELECT 1 AS x FROM messages WHERE channex_message_id = ?', m.id);
      if (already) continue;
      const ma = m.attributes ?? {};
      const direction = ma.sender === 'guest' ? 'inbound' : 'outbound';
      const sentAt = ma.inserted_at ?? nowIso();
      await run(env, `
        INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated, channex_message_id)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
        crypto.randomUUID(), local.id, direction, ma.message ?? '', sentAt, ma.sender === 'system' ? 1 : 0, m.id);
      imported++;
      if (!latestSentAt || sentAt > latestSentAt) latestSentAt = sentAt;
      if (direction === 'inbound') sawNewInbound = true;
    }
    if (latestSentAt) {
      await run(env, 'UPDATE message_threads SET last_message_at = ?, is_read = ? WHERE id = ? AND last_message_at < ?',
        latestSentAt, sawNewInbound ? 0 : 1, local.id, latestSentAt);
    }
  }
  return imported;
}

async function pullReviews(env: Env): Promise<number> {
  const res = await channexReviews(env);
  if (!res.ok) { await auditFail(env, 'channex.review_sync_failed', new Error(`status ${res.status}`)); return 0; }

  let imported = 0;
  for (const review of (res.body?.data ?? []) as any[]) {
    const already = await one(env, 'SELECT 1 AS x FROM reviews WHERE channex_review_id = ?', review.id);
    if (already) continue;

    const a = review.attributes ?? {};
    const channexBookingId: string | null = review.relationships?.booking?.data?.id ?? null;
    const reservation = await reservationFor(env, channexBookingId);
    if (!reservation) { await auditSkip(env, 'review', review.id, 'no_matching_reservation', { channexBookingId }); continue; }

    const channel = channexChannelFor(a.ota);
    if (!channel) { await auditSkip(env, 'review', review.id, 'ota_unrecognised', { ota: a.ota }); continue; }

    const rating = Math.max(0, Math.min(5, Number(a.overall_score ?? 0) / 2)); // Channex scores out of 10, we keep 0-5
    const id = crypto.randomUUID();
    await run(env, `
      INSERT INTO reviews (id, unit_id, reservation_id, channel, rating, comment, reply, replied_at, reviewed_at, channex_review_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, reservation.unit_id, reservation.id, channel, rating, a.content ?? null,
      a.reply ?? null, a.is_replied && a.reply ? (a.updated_at ?? nowIso()) : null, a.inserted_at ?? nowIso(), review.id);
    await audit(env, { actorId: null, actorLabel: 'Channex sync', action: 'channex.review_created', entityTable: 'reviews', entityId: id, after: { channexReviewId: review.id, unitId: reservation.unit_id, rating } });
    imported++;
  }
  return imported;
}

async function auditSkip(env: Env, kind: 'message_thread' | 'review', channexId: string, reason: string, details: unknown) {
  await audit(env, { actorId: null, actorLabel: 'Channex sync', action: `channex.${kind}_skipped`, entityTable: kind === 'review' ? 'reviews' : 'message_threads', entityId: channexId, after: { reason, details } }).catch(() => {});
}

async function auditFail(env: Env, action: string, e: unknown) {
  await audit(env, { actorId: null, actorLabel: 'Channex sync', action, entityTable: 'message_threads', entityId: 'sync', after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
}
