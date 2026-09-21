import { type Env, all, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession, hashPassword } from '../../_lib/auth';
import { notify } from '../../_lib/notify';

const MANAGE = ['management'];
const VIEW = ['management', 'operations_manager'];
const ROLES = ['management','operations_manager','operations_staff','finance_admin','housekeeper','technician','owner'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!VIEW.includes(session.role)) {
    return fail('FORBIDDEN', 'User accounts are managed by administrators.', 403);
  }

  const rows = await all(env, `
    SELECT id, full_name, email, phone, role, is_active, must_change_password, last_login_at, locale, created_at
    FROM users ORDER BY role, full_name`);

  // Never the password hash, the attempt counter, or the lock time.
  return json({
    generatedAt: new Date().toISOString(),
    data: rows.map((r: any) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      phone: r.phone,
      role: r.role,
      isActive: !!r.is_active,
      mustChangePassword: !!r.must_change_password,
      lastLoginAt: r.last_login_at,
      locale: r.locale,
      createdAt: r.created_at,
    })),
  });
};

/** POST — invite. Creates the account with a temporary password the user must
 *  change on first sign-in. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) {
    return fail('FORBIDDEN', 'Only management can invite new users.', 403);
  }

  const b = await request.json<any>();
  const fields: Record<string, string> = {};
  if (!b.email?.includes('@')) fields.email = 'Enter a valid work email address.';
  if (!b.fullName?.trim()) fields.fullName = 'A name is required.';
  if (!ROLES.includes(b.role)) fields.role = 'Choose a role.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the invitation details.', 422, fields);

  const exists = await one<{ id: string }>(env, 'SELECT id FROM users WHERE email = ?', b.email.toLowerCase().trim());
  if (exists) return fail('DUPLICATE', 'An account already uses that email address.', 409, { email: 'Already in use.' });

  // A random temporary password, never returned in the response body.
  const temp = crypto.randomUUID().slice(0, 12) + 'A1';
  const id = crypto.randomUUID();
  const now = nowIso();
  await run(env, `
    INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, locale, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'en-MY', 1, ?, ?)`,
    id, b.email.toLowerCase().trim(), b.fullName.trim(), b.phone ?? null,
    await hashPassword(temp), b.role, now, now);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'user.invite',
    entityTable: 'users', entityId: id, after: { email: b.email, role: b.role },
  });
  // The temporary password leaves the server here and nowhere else — it is never
  // in the response body, a log line, or the audit entry.
  await notify(env, {
    template: 'account.invited',
    recipient: b.email,
    channel: 'email',
    subject: 'Your Conts ERP account',
    body: `${session.fullName} created an account for you.\n\nEmail: ${b.email}\nTemporary password: ${temp}\n\nYou will be asked to choose a new password when you first sign in.`,
    entityTable: 'users', entityId: id,
  });

  return json({ id }, 201);
};

/** PATCH — change role or deactivate. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!MANAGE.includes(session.role)) return fail('FORBIDDEN', 'Only management can change user accounts.', 403);

  const { id, role, isActive } = await request.json<{ id: string; role?: string; isActive?: boolean }>();
  if (id === session.userId && isActive === false) {
    return fail('SELF_LOCKOUT', 'You cannot deactivate your own account.', 422);
  }
  if (role && !ROLES.includes(role)) return fail('VALIDATION', 'Unknown role.', 422);

  const before = await one<any>(env, 'SELECT role, is_active FROM users WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That account no longer exists.', 404);

  await run(env, 'UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ?',
    role ?? null, isActive === undefined ? null : (isActive ? 1 : 0), nowIso(), id);

  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'user.update',
    entityTable: 'users', entityId: id,
    before: { role: before.role, isActive: !!before.is_active },
    after: { role: role ?? before.role, isActive: isActive ?? !!before.is_active },
  });
  return json({ ok: true });
};
