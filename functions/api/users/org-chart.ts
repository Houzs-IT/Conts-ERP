import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** PUT /api/users/org-chart { managers: [{ id, managerId }] } — who reports to whom. Changes escalation and rosters, never permissions. */
export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can change the organisation chart.', 403);

  const b = await request.json<{ managers: { id: string; managerId: string | null }[] }>().catch(() => null);
  if (!Array.isArray(b?.managers) || b.managers.length > 500) return fail('VALIDATION', 'Send the reporting lines to save.', 422);

  const users = await all<{ id: string; manager_id: string | null }>(env, 'SELECT id, manager_id FROM users');
  const line = new Map(users.map(u => [u.id, u.manager_id]));
  for (const m of b.managers) {
    if (!line.has(m.id)) return fail('NOT_FOUND', 'One of those people no longer exists.', 404);
    if (m.managerId && !line.has(m.managerId)) return fail('VALIDATION', 'One of those managers no longer exists.', 422);
    line.set(m.id, m.managerId ?? null);
  }
  // A reporting line must never loop back on itself.
  for (const [start] of line) {
    const seen = new Set<string>([start]);
    for (let cur = line.get(start); cur; cur = line.get(cur) ?? null) {
      if (seen.has(cur)) return fail('VALIDATION', 'That would make two people report to each other.', 422);
      seen.add(cur);
    }
  }

  let changed = 0;
  for (const m of b.managers) {
    const before = users.find(u => u.id === m.id)!.manager_id;
    if ((before ?? null) === (m.managerId ?? null)) continue;
    await run(env, 'UPDATE users SET manager_id = ?, updated_at = ? WHERE id = ?', m.managerId ?? null, nowIso(), m.id);
    changed++;
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'user.org_chart', entityTable: 'users', entityId: 'org-chart', after: { changed } });
  return json({ ok: true, changed });
};
