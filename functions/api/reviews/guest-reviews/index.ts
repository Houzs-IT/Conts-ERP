import { mayWork } from '../../../_lib/access';
import { type Env, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession, isFieldRole } from '../../../_lib/auth';
import { guestStays, guestStay, readGuestReview, sendGuestReview, sendAfterFor } from '../../../_lib/guestReviews';
import { channexConfigured } from '../../../_lib/channex';
import { GUEST_REVIEW_WINDOW_DAYS, BAD_GUEST_SEND_DAY } from '../../../../src/lib/reviewRules';

/** GET /api/reviews/guest-reviews?view=due|sent|all&reservationId= — Review guests: finished Airbnb stays and the
 *  host's review of each guest (functions/_lib/guestReviews.ts). due: the window is open and nothing has been sent,
 *  newest checkout first, with the time left. `counts` is over the due list. Real reservations only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  const url = new URL(request.url);
  const v = url.searchParams.get('view');
  const view = v === 'sent' || v === 'all' ? v : 'due';
  const reservationId = url.searchParams.get('reservationId');
  const [data, due] = await Promise.all([
    guestStays(env, { view, reservationId }),
    view === 'due' && !reservationId ? Promise.resolve(null) : guestStays(env, { view: 'due' }),
  ]);
  const open = due ?? data;
  const soon = Date.now() + 2 * 864e5;
  return json({
    generatedAt: new Date().toISOString(), view, windowDays: GUEST_REVIEW_WINDOW_DAYS, badGuestDay: BAD_GUEST_SEND_DAY, channexConnected: channexConfigured(env),
    counts: {
      due: open.length,
      notWritten: open.filter(s => !s.review).length,
      needsApproval: open.filter(s => s.review?.state === 'needs_approval').length,
      failed: open.filter(s => s.review?.state === 'failed').length,
      held: open.filter(s => s.review?.state === 'scheduled' && s.badGuest).length,
      closingSoon: open.filter(s => !s.review && Date.parse(s.deadline) < soon).length,
    },
    data,
  });
};

/** POST /api/reviews/guest-reviews { reservationId, cleanliness, communication, respect_house_rules (1-5), publicReview,
 *  privateNote, recommend, tags } — saves the host's review of the guest and sends it to Airbnb. A Bad guest's review
 *  is held to day BAD_GUEST_SEND_DAY. Sending never fails the save: the outcome comes back as `send`, and a failed one
 *  has Retry. A review already sent cannot be changed (Airbnb does not take a second one). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can review guests.', 403);
  const b = await request.json<any>().catch(() => null);
  const reservationId = String(b?.reservationId ?? '');
  if (!reservationId) return fail('VALIDATION', 'Pick the reservation first.', 422);
  const found = await guestStay(env, reservationId);
  if (!found) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
  if (!found.airbnb) return fail('NOT_AIRBNB', 'Only Airbnb lets hosts review guests.', 422);
  const { stay, row } = found;
  if (stay.review?.state === 'sent') return fail('ALREADY_SENT', 'This guest has already been reviewed on Airbnb.', 409);
  if (!stay.windowOpen) return fail('WINDOW_CLOSED', `Airbnb's ${GUEST_REVIEW_WINDOW_DAYS}-day window for this reservation has closed.`, 422);
  const read = readGuestReview(b);
  if (!read.ok) return fail('VALIDATION', 'Check the review.', 422, read.fields);
  const g = read.value;
  const now = new Date();
  const id = stay.review?.id ?? row.id ?? crypto.randomUUID();
  const at = nowIso();
  await run(env, `
    INSERT INTO guest_reviews (id, reservation_id, state, source, cleanliness, communication, respect_house_rules, public_review, private_note, recommend, tags, send_after, written_by, written_at, attempts, last_error, created_at, updated_at)
    VALUES (?, ?, 'scheduled', 'manual', ?, ?, ?, ?, ?, ?, ?::text::jsonb, ?, ?, ?, 0, NULL, ?, ?)
    ON CONFLICT (reservation_id) DO UPDATE SET state = 'scheduled', source = 'manual', rule_id = NULL,
      cleanliness = EXCLUDED.cleanliness, communication = EXCLUDED.communication, respect_house_rules = EXCLUDED.respect_house_rules,
      public_review = EXCLUDED.public_review, private_note = EXCLUDED.private_note, recommend = EXCLUDED.recommend, tags = EXCLUDED.tags,
      send_after = EXCLUDED.send_after, written_by = EXCLUDED.written_by, written_at = EXCLUDED.written_at, attempts = 0, last_error = NULL, updated_at = EXCLUDED.updated_at
    WHERE guest_reviews.state IS DISTINCT FROM 'sent'`,
    id, reservationId, g.cleanliness, g.communication, g.respect_house_rules, g.publicReview, g.privateNote || null, g.recommend ? 1 : 0,
    g.tags.length ? JSON.stringify(g.tags) : null, sendAfterFor(stay.badGuest, row.check_out, row.check_out_time, now), session.userId, at, at, at);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review.written', entityTable: 'guest_reviews', entityId: reservationId,
    after: { cleanliness: g.cleanliness, communication: g.communication, respect_house_rules: g.respect_house_rules, recommend: g.recommend, tags: g.tags.length, badGuest: stay.badGuest } });
  const saved = await guestStay(env, reservationId);
  const send = await sendGuestReview(env, saved!.stay.review!.id, { now, actor: { id: session.userId, label: session.fullName } });
  const after = await guestStay(env, reservationId);
  return json({ ok: true, send, stay: after?.stay ?? saved!.stay });
};
