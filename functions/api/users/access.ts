import { type Env, json, fail, run, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { type Setting, forgetRules } from '../../_lib/access';
import { loadDepartments, loadRuleBook, parseRuleChanges, permissionBody, ruleKeyLabel } from '../../_lib/accessRules';

/** GET /api/users/access -> the department and position rules: every area and category, every department with its
 *  positions, and the stored rules. A key missing from `rules` means inherit (area) or not set (category). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (!session.manage) return fail('FORBIDDEN', 'Only management can see the permissions chart.', 403);
  return json(await permissionBody(env, session.role === 'management'));
};

/** PUT /api/users/access { changes: [{ scope, scopeId, key, level | null }] }. Management only: a role that could edit
 *  this chart could raise itself. `key` is an area key or `group:<Category>`; null deletes the rule. A category change
 *  writes only the category row, so areas with their own setting keep it. Management departments are always Full and
 *  refuse changes. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change permissions.', 403);

  const parsed = parseRuleChanges(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const changes = parsed.value;

  const [departments, book] = await Promise.all([loadDepartments(env), loadRuleBook(env)]);
  // scopeId -> what to call it in the audit trail, and whether it is a management department (or one of its positions).
  const scopes = new Map<string, { name: string; fixed: boolean }>();
  for (const d of departments) {
    scopes.set(`department:${d.id}`, { name: d.name, fixed: d.kind === 'management' });
    for (const p of d.positions) scopes.set(`position:${p.id}`, { name: `${d.name} / ${p.name}`, fixed: d.kind === 'management' });
  }
  for (const c of changes) {
    const scope = scopes.get(`${c.scope}:${c.scopeId}`);
    if (!scope) return fail('NOT_FOUND', `That ${c.scope} no longer exists.`, 404);
    if (scope.fixed) return fail('VALIDATION', 'Management always has full access and cannot be changed.', 400);
  }

  const now = nowIso();
  await transaction(env, async tx => {
    for (const c of changes) {
      const was: Setting | null = book[c.scope][c.scopeId]?.[c.key] ?? null;
      if (c.level === null) await run(tx, 'DELETE FROM access_rules WHERE scope = ? AND scope_id = ? AND area = ?', c.scope, c.scopeId, c.key);
      else await run(tx,
        `INSERT INTO access_rules (scope, scope_id, area, level, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        c.scope, c.scopeId, c.key, c.level, now, session.userId);
      if (was === c.level) continue;
      const name = scopes.get(`${c.scope}:${c.scopeId}`)?.name ?? c.scopeId;
      await audit(tx, {
        actorId: session.userId, actorLabel: session.fullName, action: 'user.permission_change',
        entityTable: 'access_rules', entityId: `${c.scope}:${c.scopeId}:${c.key}`,
        before: { scope: c.scope, name, area: ruleKeyLabel(c.key), level: was },
        after: { scope: c.scope, name, area: ruleKeyLabel(c.key), level: c.level },
      });
    }
  });
  forgetRules();
  return json(await permissionBody(env, true));
};
