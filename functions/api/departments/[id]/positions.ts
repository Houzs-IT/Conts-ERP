import { type Env, one, run, json, fail, audit, nowIso } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { cleanName, isRecord, isUniqueViolation, loadDepartment, loadPosition } from '../../../_lib/accessRules';

/** POST /api/departments/:id/positions { name } -> { position }. Management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can add positions.', 403);

  const departmentId = String(params.id);
  const department = await loadDepartment(env, departmentId);
  if (!department) return fail('NOT_FOUND', 'That department no longer exists.', 404);

  const b: unknown = await request.json().catch(() => null);
  const name = cleanName(isRecord(b) ? b.name : undefined);
  if (!name) return fail('VALIDATION', 'Check the position details.', 400, { name: 'Enter a name of 80 characters at most.' });

  const top = await one<{ n: number | null }>(env, 'SELECT max(sort) AS n FROM positions WHERE department_id = ?', departmentId);
  const id = crypto.randomUUID(), now = nowIso();
  try {
    await run(env, 'INSERT INTO positions (id, department_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, departmentId, name, (top?.n ?? 0) + 10, now, now);
  } catch (e) {
    if (isUniqueViolation(e)) return fail('VALIDATION', 'This department already has a position with that name.', 400, { name: 'Already used.' });
    throw e;
  }
  await audit(env, {
    actorId: session.userId, actorLabel: session.fullName, action: 'position.create', entityTable: 'positions', entityId: id,
    after: { department: department.name, name },
  });
  return json({ position: (await loadPosition(env, id))?.position ?? null }, 201);
};
