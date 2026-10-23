import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { checkPhone } from '../../_lib/validate';
import { forgetRules, isSide, roleForKind, sideFits } from '../../_lib/access';
import { loadDepartment, otherManagers } from '../../_lib/accessRules';

interface Before {
  role: string; is_active: number; manager_id: string | null; full_name: string; email: string; phone: string | null;
  department_id: string | null; position_id: string | null; department: string | null; position: string | null; side: string;
}

/** PATCH /api/users/:id { isActive?, managerId?, fullName?, email?, phone?, side?, departmentId?, positionId? } — management
 *  only. The department decides the hidden role, so `role` in the body is ignored; `side` (Works on) must fit the
 *  department (sideFits), and a department on one side puts the person on that side. Moving a person to another
 *  department clears their position unless a position of the new department is sent with it. Cleaners and technicians
 *  are managed on Workers, so their department cannot be changed here, and nobody is moved into a field department.
 *  Cannot deactivate yourself, and cannot leave the system without an active management account. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change user accounts.', 403);

  const id = String(params.id);
  const b = await request.json<{ isActive?: boolean; managerId?: string | null; fullName?: string; email?: string; phone?: string | null; side?: unknown; departmentId?: unknown; positionId?: unknown }>().catch(() => null);
  if (!b) return fail('VALIDATION', 'Nothing to change.', 422);
  if (id === session.userId && b.isActive === false) return fail('SELF_LOCKOUT', 'You cannot deactivate your own account.', 422);
  if (b.managerId && b.managerId === id) return fail('VALIDATION', 'Nobody can report to themselves.', 422, { managerId: 'Pick someone else.' });

  const fields: Record<string, string> = {};
  if (b.fullName !== undefined && !b.fullName.trim()) fields.fullName = 'Enter a name.';
  if (b.email !== undefined && !String(b.email).trim().includes('@')) fields.email = 'Enter a valid email address.';
  checkPhone(fields, 'phone', b.phone);
  if (b.departmentId !== undefined && (typeof b.departmentId !== 'string' || !b.departmentId)) fields.departmentId = 'Choose a department.';
  if (b.positionId !== undefined && b.positionId !== null && typeof b.positionId !== 'string') fields.positionId = 'Choose a position from the list.';
  if (b.side !== undefined && !isSide(b.side)) fields.side = 'Choose The Conts, Dream Crafter or Both.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the account details.', 422, fields);

  const before = await one<Before>(env, 'SELECT role, is_active, manager_id, full_name, email, phone, department_id, position_id, department, position, side FROM users WHERE id = ?', id);
  if (!before) return fail('NOT_FOUND', 'That account no longer exists.', 404);
  if (b.managerId && !(await one(env, 'SELECT 1 AS x FROM users WHERE id = ?', b.managerId))) return fail('VALIDATION', 'That manager does not exist.', 422, { managerId: 'Pick a manager from the list.' });
  if (b.email !== undefined && b.email.trim().toLowerCase() !== before.email.toLowerCase()
      && await one(env, 'SELECT 1 AS x FROM users WHERE lower(email) = lower(?) AND id != ?', b.email.trim(), id)) {
    return fail('DUPLICATE', 'Another account already uses that email address.', 409, { email: 'Already in use.' });
  }

  // Department and position. Owners have none: their login comes from the owner's record.
  const jobTouched = b.departmentId !== undefined || b.positionId !== undefined || b.side !== undefined;
  let job: { departmentId: string; positionId: string | null; department: string; position: string | null; side: string; role: string; moved: boolean } | null = null;
  if (jobTouched) {
    if (before.role === 'owner') return fail('VALIDATION', 'An owner login has no department.', 422, { departmentId: 'Owners are managed under Owners.' });
    if (before.role === 'housekeeper' || before.role === 'technician') return fail('VALIDATION', 'Cleaners and technicians are managed on Workers.', 422, { departmentId: 'Manage cleaners and technicians on Workers.' });
    const departmentId = typeof b.departmentId === 'string' ? b.departmentId : before.department_id;
    const department = departmentId ? await loadDepartment(env, departmentId) : null;
    if (!department) return fail('VALIDATION', 'That department does not exist.', 422, { departmentId: 'Choose a department from the list.' });
    const moved = department.id !== before.department_id;
    if (moved && (department.kind === 'cleaning' || department.kind === 'maintenance')) return fail('VALIDATION', 'Cleaners and technicians are added on Workers.', 422, { departmentId: 'Add cleaners and technicians on Workers.' });
    if (isSide(b.side) && !sideFits(department.side, b.side)) return fail('VALIDATION', `${department.name} works on one side only.`, 422, { departmentId: `${department.name} is not on that side.` });
    const chosen = isSide(b.side) ? b.side : isSide(before.side) ? before.side : 'both';
    const side = department.side === 'both' ? chosen : department.side;
    const wanted = b.positionId !== undefined ? (typeof b.positionId === 'string' && b.positionId ? b.positionId : null) : (moved ? null : before.position_id);
    const position = wanted ? department.positions.find(p => p.id === wanted) ?? null : null;
    if (wanted && !position) return fail('VALIDATION', 'That position is not in the department.', 422, { positionId: 'Choose a position of this department.' });
    // The hidden role is worked out from the department's kind on every save, so an old account cannot drift from it.
    job = { departmentId: department.id, positionId: position?.id ?? null, department: department.name, position: position?.name ?? null, side, role: roleForKind(department.kind), moved };
  }

  const losesAdmin = before.role === 'management' && before.is_active === 1 && ((job !== null && job.role !== 'management') || b.isActive === false);
  // A View as test account is not an administrator, so changing one never needs the check.
  if (losesAdmin && !before.email.toLowerCase().endsWith('@staging.invalid')) {
    if (await otherManagers(env, { userId: id }) === 0) return fail('LAST_ADMIN', 'There must always be at least one active management account.', 409);
  }

  await transaction(env, async tx => {
    await run(tx, `
      UPDATE users SET is_active = COALESCE(?, is_active), manager_id = CASE WHEN ? THEN ? ELSE manager_id END,
        full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = CASE WHEN ? THEN ? ELSE phone END, updated_at = ? WHERE id = ?`,
      b.isActive === undefined ? null : (b.isActive ? 1 : 0), b.managerId !== undefined, b.managerId ?? null,
      b.fullName?.trim() || null, b.email?.trim().toLowerCase() || null, b.phone !== undefined, b.phone?.trim() || null, nowIso(), id);
    // The text department and position stay in step with the names: the engine's pickers read them.
    if (job) {
      await run(tx, 'UPDATE users SET department_id = ?, position_id = ?, department = ?, position = ?, side = ?, role = ? WHERE id = ?',
        job.departmentId, job.positionId, job.department, job.position, job.side, job.role, id);
    }
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'user.update', entityTable: 'users', entityId: id,
      before: {
        role: before.role, isActive: !!before.is_active, managerId: before.manager_id, fullName: before.full_name, email: before.email, phone: before.phone,
        departmentId: before.department_id, positionId: before.position_id, department: before.department ?? null, position: before.position ?? null, side: before.side,
      },
      after: {
        role: job?.role ?? before.role, isActive: b.isActive ?? !!before.is_active, managerId: b.managerId === undefined ? before.manager_id : b.managerId,
        fullName: b.fullName ?? before.full_name, email: b.email !== undefined ? b.email.trim().toLowerCase() : before.email, phone: b.phone === undefined ? before.phone : b.phone,
        departmentId: job?.departmentId ?? before.department_id, positionId: job ? job.positionId : before.position_id,
        department: job?.department ?? before.department ?? null, position: job ? job.position : before.position ?? null, side: job?.side ?? before.side,
      },
    });
  });
  if (job) forgetRules();
  return json({ ok: true });
};
