import { mayWork } from '../../_lib/access';
import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { taskCleanersReady } from '../../_lib/taskCleaners';
import { hasEmployeeIds } from '../../_lib/fieldPin';

const EMPLOYMENT = ['internal', 'outsourced'] as const;
type Employment = (typeof EMPLOYMENT)[number];
const isEmployment = (v: unknown): v is Employment => EMPLOYMENT.includes(v as Employment);

const MANAGE = ['management']; // everyone else follows the area's level (mayWork / maySee / mayRun)

/** GET /api/housekeeping/cleaners?active=1&date=YYYY-MM-DD — the cleaner roster the operator
 *  maintains: internal staff vs outsourced third parties, each with the open job load on
 *  `date` (default today) so the assign picker can spread work. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Cleaners and technicians cannot see the roster.', 403);

  const q = new URL(request.url).searchParams;
  const activeOnly = q.get('active') === '1';
  const date = q.get('date') ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  // The roster was seeded from the housekeeper logins once (migration 0008); a cleaner login made after that was in
  // no picker until someone added it here by hand. Add each active one that no roster entry links to or is named
  // after, the same way the seed did. A cleaner taken off the roster stays as an inactive entry, so is never re-added.
  const at = nowIso();
  await run(env, `
    WITH added AS (
      INSERT INTO cleaners (id, full_name, employment_type, vendor_name, phone, user_id, is_active, created_at, updated_at)
      SELECT 'cl-' || u.id, u.full_name, 'internal', NULL, u.phone, u.id, 1, ?, ?
      FROM users u
      WHERE u.role = 'housekeeper' AND u.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM cleaners c WHERE c.user_id = u.id OR lower(c.full_name) = lower(u.full_name))
      ON CONFLICT (id) DO NOTHING
      RETURNING id, full_name, user_id)
    INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
    SELECT NULL, 'System', 'housekeeping.cleaner_create', 'cleaners', a.id, NULL,
           json_build_object('name', a.full_name, 'employment', 'internal', 'userId', a.user_id, 'reason', 'cleaner login not on the roster')::text, 'system', ?
    FROM added a`, at, at, at);
  const [ready, pins] = await Promise.all([taskCleanersReady(env), hasEmployeeIds(env)]);
  const rows = await all<any>(env, `
    SELECT c.id, c.full_name, c.employment_type, c.vendor_name, c.phone, c.user_id, c.is_active,
           ${pins ? '(SELECT u.employee_id FROM users u WHERE u.id = c.user_id)' : 'NULL'} AS employee_id,
           (SELECT COUNT(*) FROM tasks t
              WHERE (t.cleaner_id = c.id OR (c.user_id IS NOT NULL AND t.assignee_id = c.user_id)${ready ? ' OR EXISTS (SELECT 1 FROM task_cleaners tc WHERE tc.task_id = t.id AND tc.cleaner_id = c.id)' : ''})
                AND t.state NOT IN ('resolved')
                AND to_char((COALESCE(t.scheduled_for, t.due_at, t.created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
                    = COALESCE(?, to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))) AS busy
    FROM cleaners c
    ${activeOnly ? 'WHERE c.is_active = 1' : ''}
    ORDER BY c.is_active DESC, c.employment_type, c.full_name`, day);

  return json({
    data: rows.map(r => ({
      id: r.id, name: r.full_name, employmentType: r.employment_type,
      vendorName: r.vendor_name || null, phone: r.phone || null,
      userId: r.user_id || null, employeeId: r.employee_id ?? null, isActive: !!r.is_active, busy: Number(r.busy),
    })),
  });
};

/** POST /api/housekeeping/cleaners — add a cleaner to the roster.
 *  Internal cleaners may link to an existing housekeeper login (userId); outsourced
 *  cleaners carry the third-party company name and never a login. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, MANAGE)) return fail('FORBIDDEN', 'Only operations can change the roster.', 403);

  const b = await request.json<any>().catch(() => null);
  const name = typeof b?.name === 'string' ? b.name.trim() : '';
  if (!name) return fail('VALIDATION', 'Give the cleaner a name.', 422, { name: 'Enter a name.' });
  const employment: Employment = isEmployment(b?.employmentType) ? b.employmentType : 'internal';
  const vendorName = employment === 'outsourced' && typeof b?.vendorName === 'string' && b.vendorName.trim()
    ? b.vendorName.trim().slice(0, 120) : null;
  const phone = typeof b?.phone === 'string' && b.phone.trim() ? b.phone.trim().slice(0, 40) : null;

  let userId: string | null = null;
  if (employment === 'internal' && typeof b?.userId === 'string' && b.userId.trim()) {
    const u = await one<{ id: string }>(env, "SELECT id FROM users WHERE id = ? AND role = 'housekeeper'", b.userId.trim());
    if (!u) return fail('NOT_FOUND', 'That cleaner account does not exist.', 404, { userId: 'Pick a cleaner.' });
    const taken = await one<{ id: string }>(env, 'SELECT id FROM cleaners WHERE user_id = ?', u.id);
    if (taken) return fail('CONFLICT', 'That login is already on the roster.', 409, { userId: 'Already linked to a cleaner.' });
    userId = u.id;
  }

  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO cleaners (id, full_name, employment_type, vendor_name, phone, user_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id, name.slice(0, 120), employment, vendorName, phone, userId, now, now);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'housekeeping.cleaner_create',
    entityTable: 'cleaners', entityId: id, after: { name, employment, vendorName, userId },
  });
  return json({ id }, 201);
};
