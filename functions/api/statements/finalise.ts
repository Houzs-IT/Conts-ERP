import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/statements/finalise { statementIds } — provisional → finalised. From then on the figures are frozen, owners can see them, and they can be sent.
 *  Anything not provisional is named in `failed` and left alone. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Only finance and management can finalise statements.', 403);

  const b = await request.json<{ statementIds: string[] }>().catch(() => null);
  if (!Array.isArray(b?.statementIds) || !b.statementIds.length || b.statementIds.length > 200) return fail('VALIDATION', 'Select at least one statement.', 422);

  const rows = await all<{ id: string; state: string }>(env, `SELECT id, state FROM owner_statements WHERE id IN (${b.statementIds.map(() => '?').join(',')})`, ...b.statementIds);
  const ok = rows.filter(r => r.state === 'provisional');
  const failed = b.statementIds.filter(id => !ok.some(r => r.id === id)).map(id => ({ id, reason: rows.find(r => r.id === id) ? 'Only a provisional statement can be finalised.' : 'That statement no longer exists.' }));

  const now = nowIso();
  for (const r of ok) {
    await run(env, "UPDATE owner_statements SET state = 'finalised', finalised_at = ? WHERE id = ? AND state = 'provisional'", now, r.id);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'statement.finalise', entityTable: 'owner_statements', entityId: r.id, before: { state: 'provisional' }, after: { state: 'finalised' } });
  }
  return json({ finalised: ok.length, failed });
};
