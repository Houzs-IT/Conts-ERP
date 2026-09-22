import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { pushReviewReplyIfLinked } from '../../../_lib/channexMessageSync';

/** POST /api/reviews/:id/reply { body } — saves the host's reply on the review, and pushes it to
 *  the channel too when the review came from one (Airbnb, Booking.com or Expedia via Channex — a
 *  review with no channex_review_id just stays local, same as a direct-booking review always
 *  has). The push never blocks or fails this save, same rule as every other Channex sync here. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager', 'operations_staff'].includes(session.role)) return fail('FORBIDDEN', 'Only operations and management can reply to reviews.', 403);

  const id = String(params.id);
  const b = await request.json<any>().catch(() => null);
  const body = String(b?.body ?? '').trim();
  if (!body) return fail('VALIDATION', 'Write a reply first.', 422, { body: 'Write a reply.' });
  if (body.length > 1500) return fail('VALIDATION', 'That reply is too long.', 422);
  if (!(await one(env, 'SELECT 1 AS x FROM reviews WHERE id = ?', id))) return fail('NOT_FOUND', 'That review no longer exists.', 404);

  await run(env, 'UPDATE reviews SET reply = ?, replied_at = ? WHERE id = ?', body, nowIso(), id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'review.reply', entityTable: 'reviews', entityId: id, after: { length: body.length } });
  await pushReviewReplyIfLinked(env, id, body);
  return json({ ok: true });
};
