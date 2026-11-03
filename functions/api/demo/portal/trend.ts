import { type Env, json, fail } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { sampleOwnerFor, monthlyNet } from '../../../_lib/demoPortal';

/** GET /api/demo/portal/trend?ownerId=demo-...&months=8 — the sample owner's Net Payout to Owner by month, as /api/owner/trend. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', 'The sample owner portal is for management and sales staff.', 403);
  const url = new URL(request.url);
  const found = await sampleOwnerFor(env, url);
  if (found instanceof Response) return found;
  const { owner, units } = found;
  const count = Math.min(24, Math.max(1, Number(url.searchParams.get('months')) || 8));
  const points = (await monthlyNet(env, owner, units.map(u => u.id))).slice(-count);
  return json({ sample: true, months: points.length, unitLabel: units.length === 1 ? units[0].label : `${units.length} units`, points });
};
