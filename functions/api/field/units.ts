import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/field/units — every unit by building, for the field app's "Report a problem" picker. Names only: no
 *  owner, rate or revenue (GET /api/units carries those and is not open to field accounts). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  // Staff only; the middleware already keeps owner accounts out, this says so where the list is made.
  if (session.role === 'owner') return fail('FORBIDDEN', 'This is not available on the owner portal.', 403);
  const rows = await all<{ id: string; unit_number: string; property_name: string }>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    ORDER BY p.name, u.unit_number`);
  return json({ data: rows.map(r => ({ id: r.id, unitNumber: r.unit_number, propertyName: r.property_name })) });
};
