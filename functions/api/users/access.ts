import { type Env, json, fail, run, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { AREAS, EDITABLE_ROLES, GROUPS, LEVELS, ROLE_MAX, type Setting, chart, forgetAccess, groupKey, isLevel, isSetting } from '../../_lib/access';

/** GET /api/users/access -> the permissions chart: each category's baseline and each module's setting, per editable role. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!session.manage) return fail('FORBIDDEN', 'Only management can see the permissions chart.', 403);
  return json({ roles: EDITABLE_ROLES, levels: LEVELS, roleMax: ROLE_MAX, ...await chart(env), canEdit: session.role === 'management' });
};

/** One change: a category baseline (`group`, a level) or a module (`area`, a level or 'inherit'). A null level
 *  puts it back on its built-in rule. */
interface Change { role: string; area?: string; group?: string; level: Setting | null }

const RANK = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

/** PUT /api/users/access { changes: [...] }. Management only: a role that could edit this chart could raise itself.
 *  A category change writes only the category row, so modules with their own override keep it. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change permissions.', 403);

  const body = await request.json().catch(() => null) as { changes?: Change[] } | null;
  const changes = Array.isArray(body?.changes) ? body!.changes : [];
  if (changes.length === 0 || changes.length > 300) return fail('VALIDATION', 'Nothing to save.', 400);
  for (const c of changes) {
    if (!EDITABLE_ROLES.includes(c.role)) return fail('VALIDATION', 'That role’s access is fixed and cannot be changed here.', 400);
    if ((c.group === undefined) === (c.area === undefined)) return fail('VALIDATION', 'Each change is either a category or an area.', 400);
    if (c.group !== undefined && !GROUPS.includes(c.group)) return fail('VALIDATION', 'Unknown category.', 400);
    if (c.area !== undefined && !AREAS.some(a => a.key === c.area)) return fail('VALIDATION', 'Unknown area.', 400);
    // A category baseline is a level; only a module can inherit.
    if (c.level !== null && !(c.group !== undefined ? isLevel(c.level) : isSetting(c.level))) return fail('VALIDATION', 'Unknown access level.', 400);
    const max = ROLE_MAX[c.role];
    if (max && isLevel(c.level) && RANK[c.level] > RANK[max]) {
      return fail('VALIDATION', 'Operations staff is not an administrative role and cannot be given Full access.', 400);
    }
  }

  const keyOf = (c: Change) => (c.group !== undefined ? groupKey(c.group) : c.area!);
  const labelOf = (c: Change) => (c.group !== undefined ? `${c.group} (category)` : AREAS.find(a => a.key === c.area)!.label);
  const cellOf = (ch: Awaited<ReturnType<typeof chart>>, c: Change) => {
    if (c.group !== undefined) {
      const g = ch.groups.find(x => x.group === c.group)!.roles[c.role];
      const value: Setting = g.level;
      return { value, chosen: g.chosen };
    }
    const a = ch.areas.find(x => x.key === c.area)!.roles[c.role];
    return { value: a.setting, chosen: a.chosen };
  };

  const before = await chart(env);
  const now = nowIso();
  for (const c of changes) {
    if (c.level === null) await run(env, 'DELETE FROM role_access WHERE role = ? AND area = ?', c.role, keyOf(c));
    else await run(env,
      `INSERT INTO role_access (role, area, level, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (role, area) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      c.role, keyOf(c), c.level, now, session.userId);
  }
  forgetAccess();

  const after = await chart(env);
  for (const c of changes) {
    const was = cellOf(before, c);
    const is = cellOf(after, c);
    if (was.value === is.value && was.chosen === is.chosen) continue;
    await audit(env, {
      actorId: session.userId, actorLabel: session.fullName, action: 'user.permission_change',
      entityTable: 'role_access', entityId: `${c.role}:${keyOf(c)}`,
      before: { role: c.role, area: labelOf(c), level: was.value },
      after: { role: c.role, area: labelOf(c), level: is.value, builtIn: c.level === null },
    });
  }
  return json({ roles: EDITABLE_ROLES, levels: LEVELS, roleMax: ROLE_MAX, ...after, canEdit: true });
};
