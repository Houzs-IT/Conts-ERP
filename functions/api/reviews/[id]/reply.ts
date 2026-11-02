import { mayWork } from '../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { pushReviewReplyIfLinked } from '../../../_lib/channexMessageSync';

/** POST /api/reviews/:id/reply { body } — saves the host's reply on the review, and posts it to the channel too when
 *  the review came from one (Airbnb or Booking.com via Channex; a review with no channex_review_id just stays local, as
 *  a direct-booking review always has). The post never blocks or fails this save, same rule as every other Channex
 *  sync here: its outcome is kept on the review (migration 0200) and returned, so the card can say "Saved here, not
 *  posted" with a Retry. Retry is this same call with the same text. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can reply to reviews.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const body = String(b?.body ?? '').trim();
  if (!body) return fail('VALIDATION', 'Write a reply first.', 422, { body: 'Write a reply.' });
  if (body.length > 1500) return fail('VALIDATION', 'That reply is too long.', 422);
  const before = await one<{ reply: string | null; reply_push_state: string | null }>(env, 'SELECT reply, reply_push_state FROM reviews WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That review no longer exists.', 404);
  if (before.reply === body && before.reply_push_state === 'sent') return json({ ok: true, post: { state: 'sent' } });

  await run(env, 'UPDATE reviews SET reply = ?, replied_at = ? WHERE id = ?', body, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: before.reply ? 'review.reply_retry' : 'review.reply', entityTable: 'reviews', entityId: id, after: { length: body.length } });

  const post = await pushReviewReplyIfLinked(env, id, body);
  try {
    await run(env, 'UPDATE reviews SET reply_push_state = ?, reply_push_error = ? WHERE id = ?', post?.state ?? null, post?.state === 'failed' ? (post.reason ?? null) : null, id);
  } catch (e) {
    await audit(env, { actorId: null, actorLabel: 'system', action: 'review.reply_state_failed', entityTable: 'reviews', entityId: id, after: { error: String(e).slice(0, 300) } }).catch(() => {});
  }
  return json({ ok: true, post: post ?? null });
};
