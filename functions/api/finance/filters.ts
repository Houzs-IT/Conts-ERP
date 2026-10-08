import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/finance/filters — the buildings, units and owners the finance screens filter by. Small and
 *  stable, so the screens load it once instead of deriving choices from the rows they happen to hold. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Finance filters are for finance and management roles.', 403);

  const [buildings, units, owners] = await Promise.all([
    all<any>(env, 'SELECT p.id, p.name, (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id) AS n FROM properties p ORDER BY p.name'),
    all<any>(env, 'SELECT u.id, u.unit_number, u.property_id, u.owner_id FROM units u JOIN properties p ON p.id = u.property_id ORDER BY p.name, u.unit_number'),
    all<any>(env, 'SELECT o.id, o.display_name FROM owners o ORDER BY o.display_name'),
  ]);
  return json({
    generatedAt: nowIso(),
    buildings: buildings.map(b => ({ id: b.id, name: b.name, units: Number(b.n) })),
    units: units.map(u => ({ id: u.id, unitNumber: u.unit_number, buildingId: u.property_id, ownerId: u.owner_id })),
    owners: owners.map(o => ({ id: o.id, name: o.display_name })),
  }, 200, { 'cache-control': 'private, max-age=60' });
};
