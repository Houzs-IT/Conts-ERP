import { type Env, all, json, fail, run, audit, nowIso, transaction } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { isSetting, type Setting, forgetRules } from '../../../_lib/access';
import { parsePersonChanges, personAccess, ruleKeyLabel, type PersonAccess } from '../../../_lib/accessRules';

const refusal = (found: 'no-user' | 'no-department'): Response =>
  found === 'no-user'
    ? fail('NOT_FOUND', 'That account no longer exists.', 404)
    : fail('NO_DEPARTMENT', 'This account has no department, so it has no desk access to set.', 422);

/** GET /api/users/:id/access -> the person's grid: each area's level and where it comes from, their own override and
 *  what they would get without it. Management, and the person themself (read only). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  const id = String(params.id);
  if (session.role !== 'management' && session.userId !== id) return fail('FORBIDDEN', 'You can only see your own access.', 403);

  const result = await personAccess(env, id, session.role === 'management');
  if (result.found !== 'ok') return refusal(result.found);
  return json(result.body);
};

/** PUT /api/users/:id/access { changes: [{ area, level | null }] } or { resetAll: true }. Management only. A level is
 *  this person's own setting for the area (a user rule); null puts the area back on the position or department. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change a person’s access.', 403);

  const id = String(params.id);
  const parsed = parsePersonChanges(await request.json().catch(() => null));
  if (!parsed.ok) return fail('VALIDATION', parsed.message, 400);
  const input = parsed.value;

  const first = await personAccess(env, id, true);
  if (first.found !== 'ok') return refusal(first.found);
  const { user } = first.body;
  const setsLevel = !input.resetAll && input.changes.some(c => c.level !== null);
  if (setsLevel && user.kind !== 'staff') return fail('VALIDATION', 'Only office staff have desk access to set. Management is always Full.', 400);

  // What the person has now: area -> own level.
  const stored = await all<{ area: string; level: string }>(env, `SELECT area, level FROM access_rules WHERE scope = 'user' AND scope_id = ?`, id);
  const was = new Map<string, Setting>();
  for (const r of stored) if (isSetting(r.level)) was.set(r.area, r.level);
  const label = user.fullName;
  const now = nowIso();

  await transaction(env, async tx => {
    if (input.resetAll) {
      await run(tx, `DELETE FROM access_rules WHERE scope = 'user' AND scope_id = ?`, id);
      if (was.size > 0) {
        await audit(tx, {
          actorId: session.userId, actorLabel: session.fullName, action: 'user.permission_change', entityTable: 'access_rules', entityId: `user:${id}`,
          before: { user: label, overrides: Object.fromEntries([...was].map(([area, level]) => [ruleKeyLabel(area), level])) },
          after: { user: label, overrides: {} },
        });
      }
      return;
    }
    for (const c of input.changes) {
      const before = was.get(c.area) ?? null;
      if (c.level === null) await run(tx, `DELETE FROM access_rules WHERE scope = 'user' AND scope_id = ? AND area = ?`, id, c.area);
      else await run(tx,
        `INSERT INTO access_rules (scope, scope_id, area, level, updated_at, updated_by) VALUES ('user', ?, ?, ?, ?, ?)
         ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        id, c.area, c.level, now, session.userId);
      if (before === c.level) continue;
      await audit(tx, {
        actorId: session.userId, actorLabel: session.fullName, action: 'user.permission_change', entityTable: 'access_rules', entityId: `user:${id}:${c.area}`,
        before: { user: label, area: ruleKeyLabel(c.area), level: before },
        after: { user: label, area: ruleKeyLabel(c.area), level: c.level },
      });
    }
  });
  forgetRules();

  const after = await personAccess(env, id, true);
  if (after.found !== 'ok') return refusal(after.found);
  const body: PersonAccess = after.body;
  return json(body);
};
