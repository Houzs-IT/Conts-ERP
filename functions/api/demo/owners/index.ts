import { type Env, json, fail, audit, all } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { demoAllowed } from '../../../_lib/demo';
import { createSampleOwner, listSampleOwners, type NewSampleOwner } from '../../../_lib/demoOwners';

const NOT_ALLOWED = 'The sample owner portal is for management and sales staff.';

/** GET /api/demo/owners — the sample owners the sample owner portal can show. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!(await demoAllowed(env, session))) return fail('FORBIDDEN', NOT_ALLOWED, 403);
  let rows = await listSampleOwners(env);
  /* There is always one ready (owner, 11 Nov 2026): with none left, a default sample owner is made from the three real units
     with the most stays in the last 90 days, so the portal opens without setting anything up. */
  if (rows.length === 0) {
    const busiest = await all<{ id: string }>(env, `
      SELECT u.id FROM units u
      LEFT JOIN reservations r ON r.unit_id = u.id AND r.check_in >= to_char(now() - interval '90 days', 'YYYY-MM-DD')
        AND r.state NOT IN ('cancelled', 'no_show') AND r.channel NOT IN ('maintenance_block', 'owner_stay')
      GROUP BY u.id ORDER BY count(r.id) DESC, u.id LIMIT 3`);
    if (busiest.length) {
      const made = await createSampleOwner(env, { name: 'Sample Owner', unitIds: busiest.map(u => u.id), fill: true }, 'System');
      if (!(made instanceof Response)) {
        await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'demo.owner.create', entityTable: 'demo.owners', entityId: made.id, after: { name: 'Sample Owner', default: true, ...made } });
        rows = await listSampleOwners(env);
      }
    }
  }
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
