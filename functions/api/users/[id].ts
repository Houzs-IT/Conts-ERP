import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { ROLES } from '../../_lib/roles';

/** PATCH /api/users/:id { role?, isActive?, managerId? } — management only.
 *  Cannot deactivate yourself, and cannot leave the system without an active management account. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change user accounts.', 403);

  const id = String(params.id);
  const b = await request.json<{ role?: string; isActive?: boolean; managerId?: string | null }>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to change.', 422);
  if (b.role !== undefined && !ROLES.includes(b.role)) return fail('VALIDATION', 'Unknown role.', 422);
  if (b.role === 'owner') return fail('VALIDATION', 'A staff account cannot become an owner login.', 422);
  if (id === session.userId && b.isActive === false) return fail('SELF_LOCKOUT', 'You cannot deactivate your own account.', 422);
  if (b.managerId && b.managerId === id) return fail('VALIDATION', 'Nobody can report to themselves.', 422, { managerId: 'Pick someone else.' });

  const before = await one<any>(env, 'SELECT role, is_active, manager_id FROM users WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  if (b.managerId && !(await one(env, 'SELECT 1 AS x FROM users WHERE id = ?', b.managerId))) return fail('VALIDATION', 'That manager does not exist.', 422, { managerId: 'Pick a manager from the list.' });

  const losesAdmin = before.role === 'management' && before.is_active === 1 && (b.role !== undefined && b.role !== 'management' || b.isActive === false);
  if (losesAdmin) {
    const others = await one<{ n: number }>(env, `SELECT COUNT(*) AS n FROM users WHERE role = 'management' AND is_active = 1 AND id != ?`, id);
    if (!others || Number(others.n) === 0) return fail('LAST_ADMIN', 'There must always be at least one active management account.', 409);
  }

  await run(env, `
    UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active), manager_id = CASE WHEN ? THEN ? ELSE manager_id END, updated_at = ? WHERE id = ?`,
    b.role ?? null, b.isActive === undefined ? null : (b.isActive ? 1 : 0), b.managerId !== undefined, b.managerId ?? null, nowIso(), id);
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'user.update', entityTable: 'users', entityId: id,
    before: { role: before.role, isActive: !!before.is_active, managerId: before.manager_id },
    after: { role: b.role ?? before.role, isActive: b.isActive ?? !!before.is_active, managerId: b.managerId === undefined ? before.manager_id : b.managerId },
  });
  return json({ ok: true });
};
