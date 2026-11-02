import { type Env, json, fail, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { createSampleOwner, listSampleOwners, type NewSampleOwner } from '../../../_lib/demoOwners';

const NOT_ALLOWED = 'The sample owner portal is for management and sales staff.';

/** GET /api/demo/owners — the sample owners the sample owner portal can show. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  const rows = await listSampleOwners(env);
  return json({ sample: true, data: rows.map(o => ({ id: o.id, name: o.display_name, sharePct: o.default_management_fee_pct ?? 25, units: o.units, reservations: o.reservations, createdAt: o.created_at })) });
};

/** POST /api/demo/owners { name, unitIds, fill?, sharePct? } — a sample owner with sample copies of the units picked and,
 *  unless fill is false, three months of sample reservations and reviews on them. Saved in the demo store only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  const body = (await request.json().catch(() => null) ?? {}) as NewSampleOwner;
  const made = await createSampleOwner(env, body, session.fullName);
  if (made instanceof Response) return made;
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.owner.create', entityTable: 'demo.owners', entityId: made.id, after: { name: body.name, ...made } });
  return json({ sample: true, ...made }, 201);
};
