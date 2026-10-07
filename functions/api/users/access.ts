import { type Env, json, fail, run, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { AREAS, EDITABLE_ROLES, LEVELS, type Level, builtIn, chart, forgetAccess } from '../../_lib/access';

/** GET /api/users/access -> the permissions chart: every area, and each editable role's level in it. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!session.manage) return fail('FORBIDDEN', 'Only management can see the permissions chart.', 403);
  return json({ roles: EDITABLE_ROLES, levels: LEVELS, areas: await chart(env), canEdit: session.role === 'management' });
};

interface Change { role: string; area: string; level: Level | null }

/** PUT /api/users/access { changes: [{ role, area, level }] }. A null level puts the area back on its
 *  built-in rule. Management only: a role that could edit this chart could raise itself. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change permissions.', 403);

  const body = await request.json().catch(() => null) as { changes?: Change[] } | null;
  const changes = Array.isArray(body?.changes) ? body!.changes : [];
  if (changes.length === 0 || changes.length > 200) return fail('VALIDATION', 'Nothing to save.', 400);
  for (const c of changes) {
    if (!EDITABLE_ROLES.includes(c.role)) return fail('VALIDATION', 'That role’s access is fixed and cannot be changed here.', 400);
    if (!AREAS.some(a => a.key === c.area)) return fail('VALIDATION', 'Unknown area.', 400);
    if (c.level !== null && !LEVELS.includes(c.level)) return fail('VALIDATION', 'Unknown access level.', 400);
  }

  const before = await chart(env);
  const was = (c: Change) => before.find(a => a.key === c.area)!.roles[c.role];
  const now = nowIso();
  for (const c of changes) {
    if (c.level === null) await run(env, 'DELETE FROM role_access WHERE role = ? AND area = ?', c.role, c.area);
    else await run(env,
      `INSERT INTO role_access (role, area, level, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (role, area) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      c.role, c.area, c.level, now, session.userId);
  }
  forgetAccess();

  for (const c of changes) {
    const area = AREAS.find(a => a.key === c.area)!;
    const to = c.level ?? builtIn(c.role, area);
    if (was(c).level === to && was(c).chosen === (c.level !== null)) continue;
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'user.permission_change',
      entityTable: 'role_access', entityId: `${c.role}:${c.area}`,
      before: { role: c.role, area: area.label, level: was(c).level },
      after: { role: c.role, area: area.label, level: to, builtIn: c.level === null },
    });
  }
  return json({ roles: EDITABLE_ROLES, levels: LEVELS, areas: await chart(env), canEdit: true });
};
