import { type Env, run, one, json, fail, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { forgetRules } from '../../../_lib/access';
import { cleanName, isRecord, isSort, isUniqueViolation, loadPosition, parsePositionMove } from '../../../_lib/accessRules';

/** PATCH /api/departments/positions/:id { name?, sort? } -> { position }. Management only. A new name is carried to
 *  the text position of everyone in it. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change positions.', 403);

  const id = String(params.id);
  const b: unknown = await request.json().catch(() => null);
  const body = isRecord(b) ? b : {};
  const fields: Record<string, string> = {};
  const name = body.name === undefined ? undefined : cleanName(body.name);
  if (name === null) fields.name = 'Enter a name of 80 characters at most.';
  if (body.sort !== undefined && !isSort(body.sort)) fields.sort = 'Enter a whole number.';
  if (Object.keys(fields).length) return fail('VALIDATION', 'Check the position details.', 400, fields);
  const sort = isSort(body.sort) ? body.sort : undefined;
  if (name === undefined && sort === undefined) return fail('VALIDATION', 'Nothing to change.', 400);

  const cur = await loadPosition(env, id);
  if (!cur) return fail('NOT_FOUND', 'That position no longer exists.', 404);

  try {
    await transaction(env, async tx => {
      await run(tx, 'UPDATE positions SET name = COALESCE(?, name), sort = COALESCE(?, sort), updated_at = ? WHERE id = ?', name ?? null, sort ?? null, nowIso(), id);
      if (name && name !== cur.position.name) await run(tx, 'UPDATE users SET position = ? WHERE position_id = ?', name, id);
      await audit(tx, {
        actorId: session.userId, actorLabel: session.fullName, action: 'position.update', entityTable: 'positions', entityId: id,
        before: { department: cur.department.name, name: cur.position.name, sort: cur.position.sort },
        after: { department: cur.department.name, name: name ?? cur.position.name, sort: sort ?? cur.position.sort },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail('VALIDATION', 'This department already has a position with that name.', 400, { name: 'Already used.' });
    throw e;
  }
  return json({ position: (await loadPosition(env, id))?.position ?? null });
};

/** DELETE /api/departments/positions/:id { moveTo?: { positionId } } -> { ok, moved }. Management only. People in it
 *  go to `moveTo` (another position of the same department, or null for none), then the position goes with its rules.
 *  Without `moveTo` a position with people is refused with 409 HAS_PEOPLE. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can delete positions.', 403);

  const id = String(params.id);
  const cur = await loadPosition(env, id);
  if (!cur) return fail('NOT_FOUND', 'That position no longer exists.', 404);

  const parsed = parsePositionMove(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const move = parsed.value;

  const people = await one<{ n: number }>(env, 'SELECT count(*) AS n FROM users WHERE position_id = ?', id);
  const count = Number(people?.n ?? 0);
  if (count > 0 && !move) {
    return json({ error: { code: 'HAS_PEOPLE', message: `${count} ${count === 1 ? 'person has' : 'people have'} this position. Choose where to move them.`, count } }, 409);
  }

  let targetId: string | null = null;
  let targetName: string | null = null;
  if (count > 0 && move?.positionId) {
    const target = cur.department.positions.find(p => p.id === move.positionId);
    if (!target || target.id === id) return fail('VALIDATION', 'Pick another position of the same department.', 400);
    targetId = target.id;
    targetName = target.name;
  }

  await transaction(env, async tx => {
    if (count > 0) await run(tx, 'UPDATE users SET position_id = ?, position = ?, updated_at = ? WHERE position_id = ?', targetId, targetName, nowIso(), id);
    await run(tx, `DELETE FROM access_rules WHERE scope = 'position' AND scope_id = ?`, id);
    await run(tx, 'DELETE FROM positions WHERE id = ?', id);
    await audit(tx, {
      actorId: session.userId, actorLabel: session.fullName, action: 'position.delete', entityTable: 'positions', entityId: id,
      before: { department: cur.department.name, name: cur.position.name },
      after: { moved: count, movedTo: count > 0 ? targetName : null },
    });
  });
  forgetRules();
  return json({ ok: true, moved: count });
};
