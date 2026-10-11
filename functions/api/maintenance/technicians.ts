import { type Env, all, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** GET /api/maintenance/technicians — the in-house technicians' accounts, for the assign pickers. A job given to one
 *  of these shows on that person's phone; a contractor is a name only. Also the contractor names already used on
 *  jobs and templates, so the same company is typed the same way. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  const people = await all<{ id: string; full_name: string; phone: string | null }>(env, `
    SELECT id, full_name, phone FROM users WHERE role = 'technician' AND is_active = 1 ORDER BY lower(full_name)`);
  const contractors = await all<{ name: string }>(env, `
    SELECT name FROM (
      SELECT btrim(vendor_name) AS name FROM maintenance_issues WHERE vendor_name IS NOT NULL AND assignee_id IS NULL AND COALESCE(assignee_kind, 'contractor') = 'contractor'
      UNION SELECT btrim(contractor_name) FROM maintenance_templates WHERE contractor_name IS NOT NULL
    ) x WHERE name != '' GROUP BY name ORDER BY lower(name) LIMIT 200`);
  return json({ data: people.map(p => ({ id: p.id, name: p.full_name, phone: p.phone ?? null })), contractors: contractors.map(c => c.name) });
};
