import { type Env, all, json, fail } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

/** GET /api/maintenance/technicians — who a job can be given to: the company's own people (active technician,
 *  housekeeper and operations accounts, "in-house") and every contractor name already used on a job. The screen
 *  offers these as one list, so whether the person is in-house or a contractor follows from who is picked. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only the office assigns maintenance jobs.', 403);

  const [staff, contractors] = await Promise.all([
    all<{ id: string; full_name: string; role: string }>(env, `
      SELECT id, full_name, role FROM users
      WHERE is_active = 1 AND role IN ('technician','housekeeper','operations_staff','operations_manager')
      ORDER BY (role = 'technician') DESC, full_name`),
    all<{ name: string; jobs: number }>(env, `
      SELECT min(vendor_name) AS name, COUNT(*)::int AS jobs FROM maintenance_issues
      WHERE vendor_name IS NOT NULL AND trim(vendor_name) <> '' AND COALESCE(assignee_kind, 'contractor') = 'contractor'
      GROUP BY lower(trim(vendor_name)) ORDER BY COUNT(*) DESC, min(vendor_name) LIMIT 200`),
  ]);
  const staffNames = new Set(staff.map(s => s.full_name.trim().toLowerCase()));
  return json({
    data: [
      ...staff.map(s => ({ name: s.full_name, kind: 'in_house' as const, role: s.role, userId: s.id })),
      // A name that is now a staff account is listed once, as in-house.
      ...contractors.filter(c => !staffNames.has(c.name.trim().toLowerCase())).map(c => ({ name: c.name.trim(), kind: 'contractor' as const, role: null, userId: null, jobs: Number(c.jobs) })),
    ],
  });
};
