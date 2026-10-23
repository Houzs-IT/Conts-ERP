import { type Env, one, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isKind, isSide, roleForKind, forgetRules } from '../../_lib/access';
import { type Department, type Position, cleanName, isRecord, isSort, isUniqueViolation, loadDepartment, parseDepartmentMove } from '../../_lib/accessRules';

/** PATCH /api/departments/:id { name?, kind?, side?, sort? } -> { department }. Management only. A new name, kind or
 *  side is carried to every member in the same request: the text department, the hidden role, the side. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change departments.', 403);

  const id = String(params.id);
  const b: unknown = await request.json().catch(() => null);
  const body = isRecord(b) ? b : {};
  const fields: Record<string, string> = {};
  const name = body.name === undefined ? undefined : cleanName(body.name);
  if (name === null) fields.name = 'Enter a name of 80 characters at most.';
  if (body.kind !== undefined && !isKind(body.kind)) fields.kind = 'Choose a kind.';
  if (body.side !== undefined && !isSide(body.side)) fields.side = 'Choose The Conts, Dream Crafter or both.';
  if (body.sort !== undefined && !isSort(body.sort)) fields.sort = 'Enter a whole number.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the department details.', 400, fields);
  const kind = isKind(body.kind) ? body.kind : undefined;
  const side = isSide(body.side) ? body.side : undefined;
  const sort = isSort(body.sort) ? body.sort : undefined;
  if (name === undefined && kind === undefined && side === undefined && sort === undefined) return fail('VALIDATION', 'Nothing to change.', 400);

  const cur = await loadDepartment(env, id);
  if (!cur) return fail('NOT_FOUND', 'That department no longer exists.', 404);

  // Taking the kind away from a management department turns its people into staff: never the last management accounts.
  if (kind !== undefined && kind !== cur.kind && cur.kind === 'management') {
    const others = await one<{ n: number }>(env,
      `SELECT count(*) AS n FROM users WHERE role = 'management' AND is_active = 1 AND department_id IS DISTINCT FROM ?`, id);
    if (!others || Number(others.n) === 0) return fail('LAST_ADMIN', 'There must always be at least one active management account.', 409);
  }

  try {
    await transaction(env, async tx => {
      await run(tx, `UPDATE departments SET name = COALESCE(?, name), kind = COALESCE(?, kind), side = COALESCE(?, side), sort = COALESCE(?, sort), updated_at = ? WHERE id = ?`,
        name ?? null, kind ?? null, side ?? null, sort ?? null, nowIso(), id);
      if (name && name !== cur.name) await run(tx, 'UPDATE users SET department = ? WHERE department_id = ?', name, id);
      if (kind && kind !== cur.kind) await run(tx, 'UPDATE users SET role = ? WHERE department_id = ?', roleForKind(kind), id);
      if (side && side !== cur.side) await run(tx, 'UPDATE users SET side = ? WHERE department_id = ?', side, id);
      await audit(tx, {
        actorId: session.userId, actorLabel: session.fullName, action: 'department.update', entityTable: 'departments', entityId: id,
        before: { name: cur.name, kind: cur.kind, side: cur.side, sort: cur.sort },
        after: { name: name ?? cur.name, kind: kind ?? cur.kind, side: side ?? cur.side, sort: sort ?? cur.sort },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail('VALIDATION', 'A department with that name already exists.', 400, { name: 'Already used.' });
    throw e;
  }
  if (kind !== undefined && kind !== cur.kind) forgetRules();
  return json({ department: await loadDepartment(env, id) });
};

/** DELETE /api/departments/:id { moveTo?: { departmentId, positionId } } -> { ok, moved }. Management only.
 *  People in it go to `moveTo` first (department, position, the text names, the hidden role and the side all follow
 *  the new department), then the department goes with its positions and their rules. Without `moveTo` a department with
 *  people is refused with 409 HAS_PEOPLE. The management department cannot be deleted. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can delete departments.', 403);

  const id = String(params.id);
  const cur = await loadDepartment(env, id);
  if (!cur) return fail('NOT_FOUND', 'That department no longer exists.', 404);
  if (cur.kind === 'management') return fail('VALIDATION', 'The management department cannot be deleted.', 400);

  const parsed = parseDepartmentMove(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const move = parsed.value;

  // Anyone filed under one of its positions counts too, so no account is left pointing at a deleted row.
  const inside = `(department_id = ? OR position_id IN (SELECT id FROM positions WHERE department_id = ?))`;
  const people = await one<{ n: number }>(env, `SELECT count(*) AS n FROM users WHERE ${inside}`, id, id);
  const count = Number(people?.n ?? 0);
  if (count > 0 && !move) {
    return json({ error: { code: 'HAS_PEOPLE', message: `${count} ${count === 1 ? 'person is' : 'people are'} in this department. Choose where to move them.`, count } }, 409);
  }

  let target: Department | null = null;
  let targetPosition: Position | null = null;
  if (count > 0 && move) {
    target = await loadDepartment(env, move.departmentId);
    if (!target || target.id === id) return fail('VALIDATION', 'Pick another department to move people to.', 400);
    if (move.positionId) {
      targetPosition = target.positions.find(p => p.id === move.positionId) ?? null;
      if (!targetPosition) return fail('VALIDATION', 'That position is not in the department you chose.', 400);
    }
  }

  const moveTarget = target;
  await transaction(env, async tx => {
    if (moveTarget) {
      await run(tx, `UPDATE users SET department_id = ?, position_id = ?, department = ?, position = ?, role = ?, side = ?, updated_at = ? WHERE ${inside}`,
        moveTarget.id, targetPosition?.id ?? null, moveTarget.name, targetPosition?.name ?? null, roleForKind(moveTarget.kind), moveTarget.side, nowIso(), id, id);
    }
    await run(tx, `DELETE FROM access_rules WHERE scope = 'department' AND scope_id = ?`, id);
    await run(tx, `DELETE FROM access_rules WHERE scope = 'position' AND scope_id IN (SELECT id FROM positions WHERE department_id = ?)`, id);
    await run(tx, 'DELETE FROM departments WHERE id = ?', id); // its positions go with it (ON DELETE CASCADE)
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'department.delete', entityTable: 'departments', entityId: id,
      before: { name: cur.name, kind: cur.kind, side: cur.side, positions: cur.positions.map(p => p.name) },
      after: moveTarget ? { movedTo: { department: moveTarget.name, position: targetPosition?.name ?? null }, moved: count } : { moved: 0 },
    });
  });
  forgetRules();
  return json({ ok: true, moved: count });
};
