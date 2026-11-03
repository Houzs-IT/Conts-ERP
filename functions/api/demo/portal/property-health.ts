import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { sampleOwnerFor } from '../../../_lib/demoPortal';

/** GET /api/demo/portal/property-health?ownerId=demo-... — Unit health for a sample owner. Repairs are not sample data, so
 *  it is always empty (the portal then says there is no maintenance). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const found = await sampleOwnerFor(env, new URL(request.url));
  if (found instanceof Response) return found;
  return json({ sample: true, issues: [] });
};
