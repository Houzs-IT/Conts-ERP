import { mayWork } from '../../../../_lib/access';
import { type Env, one, run, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { guestStay, sendGuestReview, sendAfterFor } from '../../../../_lib/guestReviews';

/** POST /api/reviews/guest-reviews/:id/approve | retry | discard — on one written guest review (`id` is the guest
 *  review's id):
 *    approve   a review a rule wrote for approval: send it (a Bad guest's is held to day 13)
 *    retry     send a failed or waiting one again now
 *    discard   drop a review that has not been sent, so it can be written again (the Bad guest flag stays)
 *  A review already sent is never changed. Sending never fails the action; its outcome comes back as `send`. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can review guests.', 403);
  const action = String(params.action);
  if (!['approve', 'retry', 'discard'].includes(action)) return fail('NOT_FOUND', 'Unknown action.', 404);
  const id = String(params.id);
  const gr = await one<{ reservation_id: string; state: string | null; bad_guest: number }>(env, 'SELECT reservation_id, state, bad_guest FROM guest_reviews WHERE id = ?', id);
  if (!gr || gr.state == null) return fail('NOT_FOUND', 'That guest review no longer exists.', 404);
  if (gr.state === 'sent') return fail('ALREADY_SENT', 'This guest has already been reviewed on Airbnb.', 409);
  const actor = { id: session.userId, label: session.fullName };

  if (action === 'discard') {
    await run(env, `UPDATE guest_reviews SET state = NULL, source = NULL, rule_id = NULL, template_id = NULL, cleanliness = NULL, communication = NULL,
      respect_house_rules = NULL, public_review = NULL, private_note = NULL, recommend = NULL, tags = NULL, send_after = NULL, attempts = 0,
      last_error = NULL, written_by = NULL, written_at = NULL, updated_at = ? WHERE id = ? AND state IS DISTINCT FROM 'sent'`, nowIso(), id);
    await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'guest_review.discarded', entityTable: 'guest_reviews', entityId: id, before: { state: gr.state } });
    return json({ ok: true, stay: (await guestStay(env, gr.reservation_id))?.stay ?? null });
  }
  if (action === 'approve' && gr.state !== 'needs_approval') return fail('NOT_WAITING', 'This review is not waiting for approval.', 409);
  const found = await guestStay(env, gr.reservation_id);
  if (!found) return fail('NOT_FOUND', 'That reservation no longer exists.', 404);
  const now = new Date();
  await run(env, `UPDATE guest_reviews SET state = 'scheduled', send_after = ?, updated_at = ?,
      approved_by = CASE WHEN ? = 'approve' THEN ? ELSE approved_by END, approved_at = CASE WHEN ? = 'approve' THEN ? ELSE approved_at END
    WHERE id = ?`, sendAfterFor(Number(gr.bad_guest) === 1, found.row.check_out, found.row.check_out_time, now), nowIso(), action, actor.id, action, nowIso(), id);
  await audit(env, { actorId: actor.id, actorLabel: actor.label, action: action === 'approve' ? 'guest_review.approved' : 'guest_review.retry', entityTable: 'guest_reviews', entityId: id, before: { state: gr.state } });
  const send = await sendGuestReview(env, id, { now, actor });
  return json({ ok: true, send, stay: (await guestStay(env, gr.reservation_id))?.stay ?? null });
};
