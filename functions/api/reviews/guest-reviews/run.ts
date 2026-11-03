import { mayWork } from '../../../_lib/access';
import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { runGuestReviews } from '../../../_lib/guestReviews';

/** POST /api/reviews/guest-reviews/run — "Run rules now": the scheduled job's guest review run (every 15 minutes) at
 *  once: the auto rules write reviews for stays that checked out, and every review that is due is sent. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'Only operations and management can run the guest review rules.', 403);
  const r = await runGuestReviews(env);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'guest_review.run', entityTable: 'guest_reviews', entityId: 'run', after: { written: r.written, approval: r.approval, sent: r.sent, waiting: r.waiting, failed: r.failed } });
  return json({ ok: true, ...r, items: r.items.slice(0, 50) });
};
