import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed, demoAsked } from '../../../_lib/demo';
import { createReview, type ReviewInput } from '../../../_lib/demoRecords';

/** POST /api/demo/reviews { unitId, reservationId?, channel, rating, comment?, reply?, reviewedAt }
 *  A sample review, saved in schema demo and shown in Demo mode only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'Demo mode is for management and sales staff.', 403);
  if (!demoAsked(request)) return fail('DEMO_OFF', 'Turn Demo mode on to add sample data.', 409);
  const body = (await request.json().catch(() => null) ?? {}) as ReviewInput;
  const made = await createReview(env, body, session.fullName);
  if (made instanceof Response) return made;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.review.create', entityTable: 'demo.reviews', entityId: made.id, after: body });
  return json(made, 201);
};
