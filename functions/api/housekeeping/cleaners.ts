import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';

const EMPLOYMENT = ['internal', 'outsourced'] as const;
type Employment = (typeof EMPLOYMENT)[number];
const isEmployment = (v: unknown): v is Employment => EMPLOYMENT.includes(v as Employment);

const MANAGE = ['management', 'operations_manager', 'operations_staff'];

/** GET /api/housekeeping/cleaners?active=1 — the cleaner roster the operator
 *  maintains: internal staff vs outsourced third parties, each with today's open
 *  job load so the assign picker can spread work. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role)) return fail('FORBIDDEN', 'Field roles cannot see the roster.', 403);

  const activeOnly = new URL(request.url).searchParams.get('active') === '1';
  const rows = await all<any>(env, `
    SELECT c.id, c.full_name, c.employment_type, c.vendor_name, c.phone, c.user_id, c.is_active,
           (SELECT COUNT(*) FROM tasks t
              WHERE (t.cleaner_id = c.id OR (c.user_id IS NOT NULL AND t.assignee_id = c.user_id))
                AND t.state NOT IN ('resolved')
                AND to_char((COALESCE(t.scheduled_for, t.due_at, t.created_at))::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')
                    = to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YYYY-MM-DD')) AS busy
    FROM cleaners c
    ${activeOnly ? 'WHERE c.is_active = 1' : ''}
    ORDER BY c.is_active DESC, c.employment_type, c.full_name`);

  return json({
    data: rows.map(r => ({
      id: r.id, name: r.full_name, employmentType: r.employment_type,
      vendorName: r.vendor_name || null, phone: r.phone || null,
      userId: r.user_id || null, isActive: !!r.is_active, busy: Number(r.busy),
    })),
  });
};

/** POST /api/housekeeping/cleaners — add a cleaner to the roster.
 *  Internal cleaners may link to an existing housekeeper login (userId); outsourced
 *  cleaners carry the third-party company name and never a login. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only operations can change the roster.', 403);

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
    if (!u) return fail('NOT_FOUND', 'That housekeeper account does not exist.', 404, { userId: 'Pick a housekeeper.' });
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
