import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { hasEmployeeIds } from '../../_lib/fieldPin';
import { hasTechnicianList, TECH_LOGIN_ROLES } from '../../_lib/maintenance';

const MANAGE = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)
const EMPLOYMENT = ['internal', 'outsourced'] as const;
type Employment = (typeof EMPLOYMENT)[number];
const isEmployment = (v: unknown): v is Employment => EMPLOYMENT.includes(v as Employment);

/**
 * GET /api/maintenance/technicians — who a job can be given to ("who fixes it"): the active entries of the technician
 *   list (Workers > Technicians, migration 0144), in-house people first, then contractors. Without the list: the
 *   company's own people and every contractor name already used on a job, as before.
 * GET ?all=1     the whole list for Workers > Technicians, switched-off entries too, with each one's open jobs.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Only the office assigns maintenance jobs.', 403);

  const q = new URL(request.url).searchParams;
  if (!(await hasTechnicianList(env))) {
    if (q.get('all') === '1') return fail('NOT_MIGRATED', 'The technician list needs a database update (migration 0144) that has not been applied yet.', 503);
    return json({ data: await namesBeforeTheList(env) });
  }

  const pins = await hasEmployeeIds(env);
  const rows = await all<{ id: string; full_name: string; employment_type: Employment; vendor_name: string | null; phone: string | null; user_id: string | null; is_active: number; role: string | null; employee_id: string | null; busy: number }>(env, `
    SELECT t.id, t.full_name, t.employment_type, t.vendor_name, t.phone, t.user_id, t.is_active, u.role,
           ${pins ? 'u.employee_id' : 'NULL AS employee_id'},
           (SELECT COUNT(*) FROM maintenance_issues m WHERE m.technician_id = t.id AND m.state <> 'resolved') AS busy
    FROM technicians t LEFT JOIN users u ON u.id = t.user_id AND u.is_active = 1
    ${q.get('all') === '1' ? '' : 'WHERE t.is_active = 1'}
    ORDER BY t.is_active DESC, t.employment_type, t.full_name`);

  if (q.get('all') === '1') {
    return json({
      data: rows.map(r => ({
        id: r.id, name: r.full_name, employmentType: r.employment_type, vendorName: r.vendor_name, phone: r.phone,
        userId: r.role ? r.user_id : null, loginRole: r.role, employeeId: r.employee_id,
        isActive: !!r.is_active, busy: Number(r.busy),
      })),
    });
  }
  return json({
    data: rows.map(r => ({
      id: r.id, name: r.full_name, kind: r.employment_type === 'internal' ? 'in_house' as const : 'contractor' as const,
      role: r.role, userId: r.role ? r.user_id : null, jobs: Number(r.busy),
    })),
  });
};

/** The "who fixes it" list before migration 0144: staff accounts plus every contractor name used on a job. */
async function namesBeforeTheList(env: Env) {
  const [staff, contractors] = await Promise.all([
    all<{ id: string; full_name: string; role: string }>(env, `
      SELECT id, full_name, role FROM users
      WHERE is_active = 1 AND role IN ('technician','housekeeper','operations_staff')
      ORDER BY (role = 'technician') DESC, full_name`),
    all<{ name: string; jobs: number }>(env, `
      SELECT min(vendor_name) AS name, COUNT(*)::int AS jobs FROM maintenance_issues
      WHERE vendor_name IS NOT NULL AND trim(vendor_name) <> '' AND COALESCE(assignee_kind, 'contractor') = 'contractor'
      GROUP BY lower(trim(vendor_name)) ORDER BY COUNT(*) DESC, min(vendor_name) LIMIT 200`),
  ]);
  const staffNames = new Set(staff.map(s => s.full_name.trim().toLowerCase()));
  return [
    ...staff.map(s => ({ name: s.full_name, kind: 'in_house' as const, role: s.role, userId: s.id })),
    // A name that is now a staff account is listed once, as in-house.
    ...contractors.filter(c => !staffNames.has(c.name.trim().toLowerCase())).map(c => ({ name: c.name.trim(), kind: 'contractor' as const, role: null, userId: null, jobs: Number(c.jobs) })),
  ];
}

/** POST /api/maintenance/technicians { name, employmentType, vendorName?, phone?, userId? } — add someone to the list.
 *  In-house people may be linked to an existing field or operations login; contractors carry their company name. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Only operations can change the technician list.', 403);
  if (!(await hasTechnicianList(env))) return fail('NOT_MIGRATED', 'The technician list needs a database update (migration 0144) that has not been applied yet.', 503);

  const b = await request.json<Record<string, unknown>>().catch(() => null);
  const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 80) : '';
  if (!name) return fail('VALIDATION', 'Give the technician a name.', 422, { name: 'Enter a name.' });
  const employment: Employment = isEmployment(b?.employmentType) ? b.employmentType : 'internal';
  const vendorName = employment === 'outsourced' && typeof b?.vendorName === 'string' && b.vendorName.trim() ? b.vendorName.trim().slice(0, 120) : null;
  const phone = typeof b?.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 40) : null;
  const same = await one<{ id: string }>(env, 'SELECT id FROM technicians WHERE is_active = 1 AND lower(trim(full_name)) = lower(?)', name);
  if (same) return fail('CONFLICT', `${name} is already on the list. Use a different name so jobs go to the right person.`, 409, { name: 'Already on the list.' });

  let userId: string | null = null;
  if (employment === 'internal' && typeof b?.userId === 'string' && b.userId.trim()) {
    const u = await one<{ id: string }>(env, `SELECT id FROM users WHERE id = ? AND is_active = 1 AND role IN (${TECH_LOGIN_ROLES.map(() => '?').join(',')})`, b.userId.trim(), ...TECH_LOGIN_ROLES);
    if (!u) return fail('NOT_FOUND', 'That login does not exist or cannot take maintenance jobs.', 404, { userId: 'Pick a login.' });
    if (await one(env, 'SELECT 1 AS x FROM technicians WHERE user_id = ?', u.id)) return fail('CONFLICT', 'That login is already on the list.', 409, { userId: 'Already linked to someone.' });
    userId = u.id;
  }

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO technicians (id, full_name, employment_type, vendor_name, phone, user_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, id, name, employment, vendorName, phone, userId, now, now);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'maintenance.technician_create', entityTable: 'technicians', entityId: id, after: { name, employment, vendorName, userId } });
  return json({ id }, 201);
};
