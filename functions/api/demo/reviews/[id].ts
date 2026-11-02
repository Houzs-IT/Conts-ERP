import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed, demoAsked } from '../../../_lib/demo';
import { updateReview, removeDemo, type ReviewInput } from '../../../_lib/demoRecords';

async function gate(request: Request, env: Env) {
  const { session, response } = await requireSession(request, env);
  if (!session) return { session: null, response: response! };
  if (!(await demoAllowed(env, session))) return { session: null, response: fail('FORBIDDEN', 'Demo mode is for management and sales staff.', 403) };
  if (!demoAsked(request)) return { session: null, response: fail('DEMO_OFF', 'Turn Demo mode on to change sample data.', 409) };
  return { session, response: null };
}

/** PATCH /api/demo/reviews/:id — changes a review in Demo mode only (a real review gets a demo shadow). */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await gate(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const body = (await request.json().catch(() => null) ?? {}) as ReviewInput;
  const done = await updateReview(env, id, body, session.fullName);
  if (done instanceof Response) return done;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: done.shadow ? 'demo.review.shadow' : 'demo.review.update', entityTable: 'demo.reviews', entityId: id, after: body });
  return json(done);
};

/** DELETE /api/demo/reviews/:id — removes a sample review, or a real one's Demo mode changes. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await gate(request, env);
  if (!session) return response!;
  const id = String(params.id);
  const done = await removeDemo(env, 'reviews', id);
  if (done instanceof Response) return done;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.review.remove', entityTable: 'demo.reviews', entityId: id });
  return json(done);
};
