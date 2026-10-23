import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, hashPassword } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { twoFactorTables } from '../../_lib/twoFactor';
import { userJobReady } from '../../_lib/userJob';
import { hasEmployeeIds } from '../../_lib/fieldPin';
import { userSideReady } from '../../_lib/userSide';
import { isFieldKind, isSide, maySee, roleForKind, sideFits } from '../../_lib/access';
import { isRecord, loadDepartment } from '../../_lib/accessRules';

const MANAGE = ['management'];

/** GET /api/users — every office and owner account, with who each reports to. Cleaners and technicians are not here:
 *  they are added, given app access and switched off on Workers. Never the password hash or attempt counter; only
 *  whether a lock is on now. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  // The Users area level decides; where management chose none for this account, only management reads the list.
  if (!maySee(session, ['management'])) return fail('FORBIDDEN', 'User accounts are managed by administrators.', 403);

  const [totp, job, emp, side] = await Promise.all([twoFactorTables(env), userJobReady(env), hasEmployeeIds(env), userSideReady(env)]);
  const rows = await all<any>(env, `
    SELECT id, full_name, email, phone, ${emp ? 'employee_id' : 'NULL AS employee_id'}, ${job ? 'department, position' : 'NULL AS department, NULL AS position'}, ${side ? 'side' : "'both' AS side"}, role, department_id, position_id, manager_id, is_active, must_change_password, last_login_at, locale, created_at,
      COALESCE(locked_until::timestamptz > now(), false) AS is_locked, ${totp ? 'totp_enabled_at IS NOT NULL' : 'false'} AS two_step,
      (SELECT max(a.occurred_at) FROM audit_log a WHERE a.entity_table = 'users' AND a.entity_id = users.id
         AND a.action IN ('user.invite', 'user.resend_invite')) AS last_invited_at
    FROM users WHERE role NOT IN ('housekeeper', 'technician') ORDER BY role, full_name`);
  return json({
    generatedAt: nowIso(),
    jobFields: job,
    sideField: side,
    data: rows.map(r => ({
      id: r.id, fullName: r.full_name, email: r.email, employeeId: r.employee_id ?? null, phone: r.phone ?? null, department: r.department ?? null, position: r.position ?? null, side: isSide(r.side) ? r.side : 'both', departmentId: r.department_id ?? null, positionId: r.position_id ?? null, role: r.role, managerId: r.manager_id,
      isActive: !!r.is_active, mustChangePassword: !!r.must_change_password, isLocked: !!r.is_locked, twoStep: !!r.two_step, lastLoginAt: r.last_login_at,
      // When the newest invitation went out; an account made before the audit trail falls back to when it was made.
      lastInvitedAt: r.last_invited_at ?? r.created_at,
      locale: r.locale, createdAt: r.created_at,
    })),
  });
};

/** POST /api/users { fullName, email, side, departmentId, positionId?, managerId?, phone? } — an invitation. The
 *  department decides the hidden role; `side` (Works on) must fit it, and only a department on both sides leaves the
 *  choice open (sideFits). Cleaners and technicians are added on Workers, not here. The temporary password is emailed
 *  and is never in the response. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can invite new users.', 403);

  const b: unknown = await request.json().catch(() => null);
  const body = isRecord(b) ? b : {};
  const { departmentId, positionId } = body;
  const side = isSide(body.side) ? body.side : null;
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone : null;
  const managerId = typeof body.managerId === 'string' && body.managerId ? body.managerId : null;
  const fields: Record<string, string> = {};
  if (!email.includes('@')) fields.email = 'Enter a valid work email address.';
  if (!fullName) fields.fullName = 'A name is required.';
  if (typeof departmentId !== 'string' || !departmentId) fields.departmentId = 'Choose a department.';
  if (!side) fields.side = 'Choose The Conts, Dream Crafter or Both.';
  if (positionId !== undefined && positionId !== null && typeof positionId !== 'string') fields.positionId = 'Choose a position from the list.';
  if (Object.keys(fields).length || typeof departmentId !== 'string' || !side) return fail('VALIDATION', 'Check the invitation details.', 422, fields);

  const department = await loadDepartment(env, departmentId);
  if (!department) return fail('VALIDATION', 'That department does not exist.', 422, { departmentId: 'Choose a department from the list.' });
  if (isFieldKind(department.kind)) return fail('VALIDATION', 'Cleaners and technicians are added on Workers.', 422, { departmentId: 'Add cleaners and technicians on Workers.' });
  if (!sideFits(department.side, side)) return fail('VALIDATION', `${department.name} works on one side only.`, 422, { departmentId: `${department.name} is not on that side.` });
  const position = typeof positionId === 'string' && positionId ? department.positions.find(p => p.id === positionId) ?? null : null;
  if (typeof positionId === 'string' && positionId && !position) return fail('VALIDATION', 'That position is not in the department.', 422, { positionId: 'Choose a position of this department.' });

  if (await one(env, 'SELECT 1 AS x FROM users WHERE email = ?', email)) return fail('DUPLICATE', 'An account already uses that email address.', 409, { email: 'Already in use.' });
  if (managerId && !(await one(env, 'SELECT 1 AS x FROM users WHERE id = ?', managerId))) return fail('VALIDATION', 'That manager does not exist.', 422, { managerId: 'Pick a manager from the list.' });

  // The text department and position stay in step with the names: the engine's pickers read them.
  const role = roleForKind(department.kind);
  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, phone, password_hash, role, manager_id, must_change_password, locale, is_active, created_at, updated_at,
                       department_id, position_id, department, position, side)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'en-MY', 1, ?, ?, ?, ?, ?, ?, ?)`,
    id, email, fullName, phone, await hashPassword(temp), role, managerId, now, now,
    department.id, position?.id ?? null, department.name, position?.name ?? null, side);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'user.invite', entityTable: 'users', entityId: id,
    after: { email, role, side, departmentId: department.id, positionId: position?.id ?? null, department: department.name, position: position?.name ?? null } });

  // The temporary password leaves the server here and nowhere else: never in the response, a log line or the audit entry.
  const delivery = await notify(env, {
    template: 'account.invited', recipient: email, channel: 'email', subject: 'Your Conts ERP account',
    body: `${session.fullName} created an account for you.\n\nEmail: ${email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: id,
    urgent: true, // an account invite is transactional — it must not wait for quiet hours to end at 08:00
  });
  return json({ id, delivery: delivery.state, reason: delivery.reason }, 201);
};
