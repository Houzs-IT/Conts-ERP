import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { removeSampleOwner } from '../../../_lib/demoOwners';

/** DELETE /api/demo/owners/:id — removes a sample owner, its sample units and the sample reservations and reviews on them. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const id = String(params.id);
  const done = await removeSampleOwner(env, id);
  if (done instanceof Response) return done;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.owner.remove', entityTable: 'demo.owners', entityId: id });
  return json({ sample: true, ...done });
};
