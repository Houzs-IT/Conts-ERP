import { type Env, one, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { isFieldKind, isKind, isSide } from '../../_lib/access';
import { cleanName, isRecord, isUniqueViolation, loadDepartment, loadDepartments } from '../../_lib/accessRules';

/** GET /api/departments -> every department with its positions and head counts. Same gate as the permissions chart. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!session.manage) return fail('FORBIDDEN', 'Only management can see departments.', 403);
  return json({ departments: await loadDepartments(env), canEdit: session.role === 'management' });
};

/** POST /api/departments { name, kind, side } -> { department }. Management only. A new department has no rules, so
 *  its people see No access everywhere until management sets some. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can add departments.', 403);

  const b: unknown = await request.json().catch(() => null);
  const body = isRecord(b) ? b : {};
  const name = cleanName(body.name);
  const { kind, side } = body;
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'Enter a name of 80 characters at most.';
  if (!isKind(kind)) fields.kind = 'Choose a kind.';
  if (!isSide(side)) fields.side = 'Choose The Conts, Dream Crafter or both.';
  if (!name || !isKind(kind) || !isSide(side)) return fail('VALIDATION', 'Check the department details.', 400, fields);
  if (isFieldKind(kind)) return fail('VALIDATION', 'Cleaners and technicians are added on Workers.', 422, { kind: 'Choose Staff or Management.' });

  const top = await one<{ n: number | null }>(env, 'SELECT max(sort) AS n FROM departments');
  const id = crypto.randomUUID(), now = nowIso();
  try {
    await run(env, 'INSERT INTO departments (id, name, kind, side, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, name, kind, side, (top?.n ?? 0) + 10, now, now);
  } catch (e) {
    if (isUniqueViolation(e)) return fail('VALIDATION', 'A department with that name already exists.', 400, { name: 'Already used.' });
    throw e;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'department.create', entityTable: 'departments', entityId: id, after: { name, kind, side } });
  return json({ department: await loadDepartment(env, id) }, 201);
};
