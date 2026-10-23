import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, hashPassword } from '../../_lib/auth';
import { notify } from '../../_lib/notify';
import { ROLES } from '../../_lib/roles';
import { twoFactorTables } from '../../_lib/twoFactor';
import { userJobReady, cleanJob } from '../../_lib/userJob';
import { hasEmployeeIds } from '../../_lib/fieldPin';
import { userSideReady } from '../../_lib/userSide';
import { isSide } from '../../_lib/access';

const MANAGE = ['management'];
const VIEW = ['management', 'operations_manager'];

/** GET /api/users — every account, with who each reports to. Never the password hash or attempt counter; only whether a lock is on now. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!VIEW.includes(session.role)) return fail('FORBIDDEN', 'User accounts are managed by administrators.', 403);

  const [totp, job, emp, side] = await Promise.all([twoFactorTables(env), userJobReady(env), hasEmployeeIds(env), userSideReady(env)]);
  const rows = await all<any>(env, `
    SELECT id, full_name, email, phone, ${emp ? 'employee_id' : 'NULL AS employee_id'}, ${job ? 'department, position' : 'NULL AS department, NULL AS position'}, ${side ? 'side' : "'both' AS side"}, role, manager_id, is_active, must_change_password, last_login_at, locale, created_at,
      COALESCE(locked_until::timestamptz > now(), false) AS is_locked, ${totp ? 'totp_enabled_at IS NOT NULL' : 'false'} AS two_step,
      (SELECT max(a.occurred_at) FROM audit_log a WHERE a.entity_table = 'users' AND a.entity_id = users.id
         AND a.action IN ('user.invite', 'user.resend_invite')) AS last_invited_at
    FROM users ORDER BY role, full_name`);
  return json({
    generatedAt: nowIso(),
    jobFields: job,
    sideField: side,
    data: rows.map(r => ({
      id: r.id, fullName: r.full_name, email: r.email, employeeId: r.employee_id ?? null, phone: r.phone ?? null, department: r.department ?? null, position: r.position ?? null, side: isSide(r.side) ? r.side : 'both', role: r.role, managerId: r.manager_id,
      isActive: !!r.is_active, mustChangePassword: !!r.must_change_password, isLocked: !!r.is_locked, twoStep: !!r.two_step, lastLoginAt: r.last_login_at,
      // When the newest invitation went out; an account made before the audit trail falls back to when it was made.
      lastInvitedAt: r.last_invited_at ?? r.created_at,
      locale: r.locale, createdAt: r.created_at,
    })),
  });
};

/** POST /api/users { fullName, email, role, managerId?, department?, position?, side? } — an invitation. The temporary password is emailed and is never in the response. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can invite new users.', 403);

  const b = await request.json<any>().catch(() => null);
  const fields: Record<string, string> = {};
  if (!b?.email?.includes('@')) fields.email = 'Enter a valid work email address.';
  if (!b?.fullName?.trim()) fields.fullName = 'A name is required.';
  if (!ROLES.includes(b?.role)) fields.role = 'Choose a role.';
  if (b?.side !== undefined && !isSide(b.side)) fields.side = 'Choose The Conts, Dream Crafter or both.';
  const jobIn = cleanJob(b, fields);
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the invitation details.', 422, fields);
  if (b.role === 'owner') return fail('VALIDATION', 'Owner logins are created from the owner\'s record under Owners.', 422, { role: 'Invite owners from the Owners screen.' });

  const email = b.email.toLowerCase().trim();
  if (await one(env, 'SELECT 1 AS x FROM users WHERE email = ?', email)) return fail('DUPLICATE', 'An account already uses that email address.', 409, { email: 'Already in use.' });
  if (b.managerId && !(await one(env, 'SELECT 1 AS x FROM users WHERE id = ?', b.managerId))) return fail('VALIDATION', 'That manager does not exist.', 422, { managerId: 'Pick a manager from the list.' });

  const [job, sideCol] = await Promise.all([userJobReady(env), userSideReady(env)]);
  const side = sideCol && isSide(b.side) ? b.side : null;
  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  const id = crypto.randomUUID(), now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, phone, password_hash, role, manager_id, must_change_password, locale, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'en-MY', 1, ?, ?)`, id, email, b.fullName.trim(), b.phone ?? null, await hashPassword(temp), b.role, b.managerId ?? null, now, now);
  if (job && (jobIn.department || jobIn.position)) {
    await run(env, 'UPDATE users SET department = ?, position = ? WHERE id = ?', jobIn.department ?? null, jobIn.position ?? null, id);
  }
  if (side) await run(env, 'UPDATE users SET side = ? WHERE id = ?', side, id);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'user.invite', entityTable: 'users', entityId: id,
    after: { email, role: b.role, ...(side ? { side } : {}), ...(job ? { department: jobIn.department ?? null, position: jobIn.position ?? null } : {}) } });

  // The temporary password leaves the server here and nowhere else: never in the response, a log line or the audit entry.
  const delivery = await notify(env, {
    template: 'account.invited', recipient: email, channel: 'email', subject: 'Your Conts ERP account',
    body: `${session.fullName} created an account for you.\n\nEmail: ${email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: id,
    urgent: true, // an account invite is transactional — it must not wait for quiet hours to end at 08:00
  });
  return json({ id, delivery: delivery.state, reason: delivery.reason }, 201);
};
