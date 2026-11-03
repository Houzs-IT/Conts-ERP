import { type Env, all, one, run, audit, nowIso, inDemo } from './db';
import { categoryKey, isBadReview, nativeOverall, scaleText } from '../../src/lib/reviewRules';
import { notifyUsers } from './notify';
import { peopleWithAccess } from './access';
import { CHANNEX_PAGE, channexConfigured, channexChannelFor, channexMessageThreads, channexThreadMessages, channexReviews, channexSendMessage, channexReplyToReview } from './channex';

export interface ChannexDelivery { state: 'sent' | 'failed' | 'not_linked'; reason?: string }

/** Sends a staff reply out to the guest on Airbnb or Booking.com's own messaging system. A thread
 *  only has a channex_thread_id if it came from Channex in the first place — that already rules
 *  out Agoda (Channex has no Messages API for it) and every local-only thread (direct/WhatsApp),
 *  so no separate channel check is needed. Never throws: a guest reply must always save locally
 *  even if the push to the channel fails, same rule as every other Channex sync in this app —
 *  the caller gets a status back to show the user, but the local save already happened either
 *  way. Saves the OTA's own message id onto the local row so a later pull recognises this message
 *  and does not import it again as a duplicate inbound copy.
 *  'not_linked': the conversation has no channel behind it. 'failed': it has one, and the send did not go through. */
export async function pushMessageIfLinked(env: Env, threadId: string, localMessageId: string, body: string): Promise<ChannexDelivery> {
  try {
    const thread = await one<{ channex_thread_id: string | null }>(env, 'SELECT channex_thread_id FROM message_threads WHERE id = ?', threadId);
    if (!thread?.channex_thread_id) return { state: 'not_linked' };
    if (!channexConfigured(env)) return { state: 'failed', reason: 'Channex is not connected on this system.' };
    const res = await channexSendMessage(env, thread.channex_thread_id, body);
    if (res.ok && res.body?.data?.id) {
      await run(env, 'UPDATE messages SET channex_message_id = ? WHERE id = ?', res.body.data.id, localMessageId);
      return { state: 'sent' };
    }
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.message_push_failed', entityTable: 'messages', entityId: localMessageId, after: { status: res.status } });
    return { state: 'failed', reason: refusal(res.status) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.message_push_failed', entityTable: 'messages', entityId: localMessageId, after: { error: message } }).catch(() => {});
    return { state: 'failed', reason: 'The channel could not be reached. Try again in a moment.' };
  }
}

const refusal = (status: number) => status === 403
  ? 'The Messages & Reviews app is not installed in Channex.'
  : `The channel refused it (status ${status}).`;

/** A host's reply to a review, posted to the channel. Returns null when the review is not linked to a channel (a
 *  direct-booking review, or one typed in here): there is nothing to post to. Never throws, as above. */
export async function pushReviewReplyIfLinked(env: Env, reviewId: string, reply: string): Promise<{ state: 'sent' | 'failed'; reason?: string } | null> {
  try {
    const review = await one<{ channex_review_id: string | null }>(env, 'SELECT channex_review_id FROM reviews WHERE id = ?', reviewId);
    if (!review?.channex_review_id) return null;
    if (inDemo()) return { state: 'failed', reason: 'Demo: saved in the demo store, not posted to the channel.' };
    if (!channexConfigured(env)) return { state: 'failed', reason: 'Channex is not connected on this system.' };
    const res = await channexReplyToReview(env, review.channex_review_id, reply);
    if (res.ok) return { state: 'sent' };
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.review_reply_push_failed', entityTable: 'reviews', entityId: reviewId, after: { status: res.status } });
    return { state: 'failed', reason: refusal(res.status) };
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.review_reply_push_failed', entityTable: 'reviews', entityId: reviewId, after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return { state: 'failed', reason: 'The channel could not be reached. Try again in a moment.' };
  }
}

/** Outside calls one pull may make. The Workers free plan allows 50 per request, and the pull runs on a request (the
 *  webhook, the Sync button) after the booking feed. A conversation left over is read on the next pull. */
const MAX_CALLS = 20;
const MAX_PAGES = 5;
/** Calls kept back from messages so reviews are always read too. */
const REVIEW_RESERVE = 3;

type Budget = { left: number };
const json = (ids: string[]) => JSON.stringify(ids);

/** Pulls guest messages and reviews from Channex. There is no acknowledge-the-feed mechanism for these two, so
 *  "already seen" is tracked on our side: a message by its OTA id, a conversation and a review by Channex's own change
 *  time (channex_seen_at, channex_updated_at). Pages through both lists and stops at the first page where nothing
 *  changed. Never throws: called from a webhook that must answer 200 either way, and from the Sync button. */
export async function processChannexMessagesAndReviews(env: Env): Promise<{ messages: number; reviews: number }> {
  if (!channexConfigured(env)) return { messages: 0, reviews: 0 };
  const budget: Budget = { left: MAX_CALLS };
  const messages = await pullMessages(env, budget).catch(async (e) => {
    await auditFail(env, 'channex.message_sync_failed', e);
    return 0;
  });
  const reviews = await pullReviews(env, budget).catch(async (e) => {
    await auditFail(env, 'channex.review_sync_failed', e);
    return 0;
  });
  return { messages, reviews };
}

/** Reservations by Channex booking id, and the unit of each Channex property that has exactly one unit (a building
 *  shared by several units cannot say which one a conversation is about). */
async function lookups(env: Env, bookingIds: string[], propertyIds: string[]) {
  const [res, units] = await Promise.all([
    bookingIds.length ? all<{ id: string; unit_id: string; guest_id: string | null; channex_booking_id: string }>(env,
      'SELECT id, unit_id, guest_id, channex_booking_id FROM reservations WHERE channex_booking_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', json(bookingIds)) : [],
    propertyIds.length ? all<{ channex_property_id: string; unit_id: string }>(env, `
      SELECT channex_property_id, min(id) AS unit_id FROM units
      WHERE channex_property_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) GROUP BY channex_property_id HAVING count(*) = 1`, json(propertyIds)) : [],
  ]);
  return {
    reservation: new Map(res.map(r => [r.channex_booking_id, r])),
    unit: new Map(units.map(u => [u.channex_property_id, u.unit_id])),
  };
}

const bookingOf = (x: any): string | null => x.relationships?.booking?.data?.id ?? null;
const propertyOf = (x: any): string | null => x.relationships?.property?.data?.id ?? null;

/** Files on a message: Channex gives a list of addresses, or of objects with one. Only http(s) links are kept. */
function attachmentsOf(ma: any): { url: string; name: string }[] | null {
  const list = Array.isArray(ma.attachments) ? ma.attachments : [];
  const out = list.map((a: any) => {
    const url = typeof a === 'string' ? a : a?.url ?? a?.file_url ?? null;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    const name = (typeof a === 'object' && (a.file_name ?? a.name)) || decodeURIComponent(url.split('?')[0].split('/').pop() || 'Attachment');
    return { url, name: String(name).slice(0, 200) };
  }).filter(Boolean) as { url: string; name: string }[];
  return out.length ? out : null;
}

async function pullMessages(env: Env, budget: Budget): Promise<number> {
  // 1. The conversations that changed, page by page, stopping at a page where none did. If the last pull ran out of
  // calls before reading every changed conversation, the ones left can sit on a later page behind a page that is all
  // read now, so this pull reads every page (up to MAX_PAGES) until it catches up.
  const backlog = (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', BACKLOG_KEY))?.value === '1';
  const changed: any[] = [];
  const known = new Map<string, { id: string; channex_seen_at: string | null; reservation_id: string | null }>();
  for (let page = 1; page <= MAX_PAGES && budget.left > REVIEW_RESERVE; page++) {
    budget.left--;
    const res = await channexMessageThreads(env, page);
    // 403: the Messages app is not installed on the Channex account. That is a setting, not a failure, and
    // this runs on every booking notification, so it must not fill the audit feed.
    if (res.status === 403) return 0;
    if (!res.ok) { await auditFail(env, 'channex.message_sync_failed', new Error(`status ${res.status}`)); return 0; }
    const data = (res.body?.data ?? []) as any[];
    const rows = data.length ? await all<{ id: string; channex_thread_id: string; channex_seen_at: string | null; reservation_id: string | null }>(env,
      'SELECT id, channex_thread_id, channex_seen_at, reservation_id FROM message_threads WHERE channex_thread_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', json(data.map(t => t.id))) : [];
    for (const r of rows) known.set(r.channex_thread_id, r);
    const fresh = data.filter(t => {
      const k = known.get(t.id);
      return !k || k.channex_seen_at !== seenAt(t) || (!k.reservation_id && bookingOf(t));
    });
    changed.push(...fresh);
    if ((!fresh.length && !backlog) || data.length < CHANNEX_PAGE) break;
  }
  if (!changed.length) { if (backlog) await setBacklog(env, false); return 0; }

  const { reservation, unit } = await lookups(env, changed.map(bookingOf).filter(Boolean) as string[], changed.map(propertyOf).filter(Boolean) as string[]);
  let imported = 0, done = 0;
  for (const thread of changed) {
    if (budget.left <= REVIEW_RESERVE) break;
    done++;
    const a = thread.attributes ?? {};
    const channel = channexChannelFor(a.provider);
    if (!channel) { await auditSkip(env, 'message_thread', thread.id, 'ota_unrecognised', { provider: a.provider }); continue; }
    const booking = bookingOf(thread);
    const r = booking ? reservation.get(booking) ?? null : null;
    // No booking we know of: an inquiry before booking, or a booking not imported yet. Kept, tied to the unit when
    // the listing has one, and linked to the booking once it arrives.
    const unitId = r?.unit_id ?? unit.get(propertyOf(thread) ?? '') ?? null;
    let local = known.get(thread.id);
    if (!local) {
      const id = crypto.randomUUID();
      // Read, and dated as Channex dates it: the messages below decide whether it is unread.
      await run(env, `
        INSERT INTO message_threads (id, reservation_id, guest_id, unit_id, guest_name, channel, subject, channex_thread_id, is_read, last_message_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        id, r?.id ?? null, r?.guest_id ?? null, unitId, a.title ?? null, channel, r ? 'Stay' : 'Inquiry', thread.id, a.last_message_received_at ?? a.inserted_at ?? nowIso());
      local = { id, channex_seen_at: null, reservation_id: r?.id ?? null };
    } else if (!local.reservation_id && r) {
      await run(env, 'UPDATE message_threads SET reservation_id = ?, guest_id = COALESCE(guest_id, ?), unit_id = COALESCE(unit_id, ?), subject = CASE WHEN subject = \'Inquiry\' THEN \'Stay\' ELSE subject END WHERE id = ?',
        r.id, r.guest_id, r.unit_id, local.id);
    }

    budget.left--;
    const msgRes = await channexThreadMessages(env, thread.id);
    if (!msgRes.ok) { done--; continue; } // seen time not saved: tried again on the next pull
    const msgs = (msgRes.body?.data ?? []) as any[];
    const have = new Set((msgs.length ? await all<{ channex_message_id: string }>(env,
      'SELECT channex_message_id FROM messages WHERE channex_message_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', json(msgs.map(m => m.id))) : []).map(m => m.channex_message_id));
    const rows = msgs.filter(m => !have.has(m.id)).map(m => {
      const ma = m.attributes ?? {};
      return {
        id: crypto.randomUUID(), thread_id: local!.id, direction: ma.sender === 'guest' ? 'inbound' : 'outbound', body: String(ma.message ?? ''),
        sent_at: ma.inserted_at ?? nowIso(), is_automated: ma.sender === 'system' ? 1 : 0, channex_message_id: m.id, attachments: attachmentsOf(ma),
      };
    });
    if (rows.length) {
      await run(env, `
        INSERT INTO messages (id, thread_id, direction, sender_id, body, sent_at, is_automated, channex_message_id, attachments)
        SELECT x.id, x.thread_id, x.direction, NULL, x.body, x.sent_at, x.is_automated, x.channex_message_id, x.attachments
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, thread_id text, direction text, body text, sent_at text, is_automated int, channex_message_id text, attachments jsonb)
        ON CONFLICT DO NOTHING`, JSON.stringify(rows));
      imported += rows.length;
    }
    const latest = rows.reduce<string | null>((m, x) => (!m || x.sent_at > m ? x.sent_at : m), null);
    // A new message from the guest makes the conversation unread, whatever its date. (It used to flip only when the
    // message was newer than last_message_at, which a new conversation had just been given, so it stayed read.)
    const newInbound = rows.some(x => x.direction === 'inbound');
    await run(env, `
      UPDATE message_threads SET last_message_at = GREATEST(last_message_at, COALESCE(?, last_message_at)),
        is_read = CASE WHEN ?::boolean THEN 0 ELSE is_read END, channex_seen_at = ?
      WHERE id = ?`, latest, newInbound, seenAt(thread), local.id);
  }
  if ((done < changed.length) !== backlog) await setBacklog(env, done < changed.length);
  return imported;
}

const BACKLOG_KEY = 'channex.message_threads_backlog';
const setBacklog = (env: Env, on: boolean) => run(env,
  'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at',
  BACKLOG_KEY, on ? '1' : '0', nowIso());

const seenAt = (t: any): string | null => t.attributes?.updated_at ?? t.attributes?.last_message_received_at ?? null;

/** Booking.com sends its text in parts; Airbnb as one. */
function reviewText(a: any): string | null {
  if (a.content) return String(a.content);
  const rc = a.raw_content ?? {};
  const parts = [rc.headline, rc.public_review, rc.positive && `Liked: ${rc.positive}`, rc.negative && `Disliked: ${rc.negative}`].filter(Boolean);
  return parts.length ? parts.join('\n') : null;
}

/** Category scores, each out of 10 as Channex gives them, under our names (src/lib/reviewRules.ts categoryKey:
 *  Channex's "clean" is cleanliness). Airbnb: cleanliness, accuracy, communication, check-in, location, value;
 *  Booking.com: staff, facilities, cleanliness, comfort, value, location. */
function scoresOf(a: any): { category: string; score: number }[] | null {
  const list = Array.isArray(a.scores) ? a.scores : [];
  const out = list.map((s: any) => ({ category: categoryKey(String(s.category ?? '')), score: Number(s.score) }))
    .filter((s: { category: string; score: number }) => s.category && Number.isFinite(s.score));
  return out.length ? out : null;
}

async function pullReviews(env: Env, budget: Budget): Promise<number> {
  const changed: any[] = [];
  const known = new Map<string, { id: string; channex_updated_at: string | null }>();
  for (let page = 1; page <= MAX_PAGES && budget.left > 0; page++) {
    budget.left--;
    const res = await channexReviews(env, page);
    if (res.status === 403) return 0; // the Reviews app is not installed on the Channex account, as above
    if (!res.ok) { await auditFail(env, 'channex.review_sync_failed', new Error(`status ${res.status}`)); return 0; }
    const data = (res.body?.data ?? []) as any[];
    const rows = data.length ? await all<{ id: string; channex_review_id: string; channex_updated_at: string | null }>(env,
      'SELECT id, channex_review_id, channex_updated_at FROM reviews WHERE channex_review_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', json(data.map(r => r.id))) : [];
    for (const r of rows) known.set(r.channex_review_id, r);
    const fresh = data.filter(r => { const k = known.get(r.id); return !k || k.channex_updated_at !== (r.attributes?.updated_at ?? null); });
    changed.push(...fresh);
    // Every page, not just up to an unchanged one: Channex lists reviews in the order they came in, so a guest editing an
    // old review, or a reply posted to it on the site, changes a review on a later page. Reviews cost no call each.
    if (data.length < CHANNEX_PAGE) break;
  }
  if (!changed.length) return 0;

  const { reservation, unit } = await lookups(env, changed.map(bookingOf).filter(Boolean) as string[], changed.map(propertyOf).filter(Boolean) as string[]);
  const rows = [] as Record<string, unknown>[];
  for (const review of changed) {
    const a = review.attributes ?? {};
    const channel = channexChannelFor(a.ota);
    if (!channel) { await auditSkip(env, 'review', review.id, 'ota_unrecognised', { ota: a.ota }); continue; }
    const r = reservation.get(bookingOf(review) ?? '') ?? null;
    const reply = a.reply ? String(a.reply) : null;
    rows.push({
      id: known.get(review.id)?.id ?? crypto.randomUUID(), channex_review_id: review.id,
      unit_id: r?.unit_id ?? unit.get(propertyOf(review) ?? '') ?? null, reservation_id: r?.id ?? null, channel,
      rating: Math.max(0, Math.min(5, Number(a.overall_score ?? 0) / 2)), // Channex scores out of 10, we keep 0-5
      comment: reviewText(a), guest_name: a.guest_name ?? null, scores: scoresOf(a),
      is_hidden: a.is_hidden === true ? 1 : 0, tags: Array.isArray(a.tags) && a.tags.length ? a.tags.map((x: unknown) => String(x)).slice(0, 60) : null,
      channel_reply: reply, channel_replied_at: reply ? (a.replied_at ?? a.updated_at ?? nowIso()) : null,
      reviewed_at: a.received_at ?? a.inserted_at ?? nowIso(), channex_updated_at: a.updated_at ?? null,
    });
  }
  if (!rows.length) return 0;
  // One write for new and changed reviews. A reply typed here is never overwritten; a reply written on the channel's
  // site fills an empty one, and the channel showing our reply marks a failed post as sent.
  await run(env, `
    INSERT INTO reviews (id, channex_review_id, unit_id, reservation_id, channel, rating, comment, guest_name, scores, is_hidden, tags, channel_reply, channel_replied_at, reply, replied_at, reviewed_at, channex_updated_at)
    SELECT x.id, x.channex_review_id, x.unit_id, x.reservation_id, x.channel, x.rating, x.comment, x.guest_name, x.scores, x.is_hidden, x.tags, x.channel_reply, x.channel_replied_at, x.channel_reply, x.channel_replied_at, x.reviewed_at, x.channex_updated_at
    FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, channex_review_id text, unit_id text, reservation_id text, channel text, rating double precision, comment text, guest_name text, scores jsonb, is_hidden int, tags jsonb, channel_reply text, channel_replied_at text, reviewed_at text, channex_updated_at text)
    ON CONFLICT (id) DO UPDATE SET
      unit_id = COALESCE(reviews.unit_id, EXCLUDED.unit_id), reservation_id = COALESCE(reviews.reservation_id, EXCLUDED.reservation_id),
      rating = EXCLUDED.rating, comment = EXCLUDED.comment, guest_name = EXCLUDED.guest_name, scores = EXCLUDED.scores,
      is_hidden = EXCLUDED.is_hidden, tags = EXCLUDED.tags,
      channel_reply = EXCLUDED.channel_reply, channel_replied_at = EXCLUDED.channel_replied_at, channex_updated_at = EXCLUDED.channex_updated_at,
      reply = COALESCE(reviews.reply, EXCLUDED.channel_reply), replied_at = COALESCE(reviews.replied_at, EXCLUDED.channel_replied_at),
      reply_push_state = CASE WHEN reviews.reply_push_state = 'failed' AND EXCLUDED.channel_reply IS NOT NULL AND EXCLUDED.channel_reply = reviews.reply THEN 'sent' ELSE reviews.reply_push_state END,
      reply_push_error = CASE WHEN reviews.reply_push_state = 'failed' AND EXCLUDED.channel_reply IS NOT NULL AND EXCLUDED.channel_reply = reviews.reply THEN NULL ELSE reviews.reply_push_error END`,
    JSON.stringify(rows));
  const created = rows.filter(x => !known.has(String(x.channex_review_id)));
  await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.reviews_pulled', entityTable: 'reviews', entityId: 'sync', after: { created: created.length, updated: rows.length - created.length } });
  await alertNewReviews(env, created);
  return rows.length;
}

/** A notice to everyone who works on Reviews for each new review (owner, 3 Nov 2026), loud for a bad one. One notice
 *  per review and person (dedupe key), so a pull that runs again does not repeat it. More than BULK new reviews at
 *  once (the first pull of an account) become one notice. Never throws: notifyUsers records its own failures. */
const BULK = 5;
async function alertNewReviews(env: Env, created: Record<string, unknown>[]) {
  if (!created.length) return;
  try {
    const people = (await peopleWithAccess(env, 'pricing', 'edit')).map(p => p.id);
    if (!people.length) return;
    const name = (ch: unknown) => (ch === 'booking_com' ? 'Booking.com' : ch === 'airbnb' ? 'Airbnb' : String(ch));
    if (created.length > BULK) {
      const bad = created.filter(x => isBadReview(Number(x.rating))).length;
      await notifyUsers(env, people, {
        kind: 'review.new', title: `${created.length} new reviews${bad ? `, ${bad} bad` : ''}`, body: 'Open Reviews to read them and reply.',
        link: bad ? '/performance/reviews?tab=bad' : '/performance/reviews?tab=all&reply=needs_reply', entityTable: 'reviews', entityId: 'sync',
        dedupeKey: `review.new.bulk:${created.map(x => x.id).sort()[0]}`,
      });
      return;
    }
    await Promise.all(created.map(x => {
      const bad = isBadReview(Number(x.rating));
      const score = scaleText(nativeOverall(String(x.channel), Number(x.rating)));
      const guest = String(x.guest_name ?? 'A guest');
      return notifyUsers(env, people, {
        kind: bad ? 'review.bad' : 'review.new',
        title: bad ? `Bad review: ${score} from ${guest} on ${name(x.channel)}` : `New review: ${score} from ${guest} on ${name(x.channel)}`,
        body: x.comment ? String(x.comment).slice(0, 240) : (x.is_hidden ? 'Hidden until you review the guest.' : null),
        link: `/performance/reviews?tab=${bad ? 'bad' : 'all'}&q=${encodeURIComponent(guest)}`, entityTable: 'reviews', entityId: String(x.id),
        dedupeKey: `review.new:${x.id}`, email: bad,
      });
    }));
  } catch (e) {
    await auditFail(env, 'review.alert_failed', e);
  }
}

async function auditSkip(env: Env, kind: 'message_thread' | 'review', channexId: string, reason: string, details: unknown) {
  await audit(env, { actorId: null, actorLabel: 'Channex', action: `channex.${kind}_skipped`, entityTable: kind === 'review' ? 'reviews' : 'message_threads', entityId: channexId, after: { reason, details } }).catch(() => {});
}

async function auditFail(env: Env, action: string, e: unknown) {
  await audit(env, { actorId: null, actorLabel: 'Channex', action, entityTable: 'message_threads', entityId: 'sync', after: { error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
}
