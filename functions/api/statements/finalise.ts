import { type Env, all, run, json, fail, nowIso } from '../../_lib/db';
import { auditMany } from '../../_lib/history';
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
  // A bill the owner pays that was added after the draft was made (a late utility bill rolls onto the next open
  // month, which is often a draft already): finalising the draft as it stands would leave the bill on no statement.
  const stale = new Set((await all<{ id: string }>(env, `
    SELECT s.id FROM owner_statements s WHERE s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND s.state = 'provisional'
      AND EXISTS (SELECT 1 FROM expenses e JOIN units u ON u.id = e.unit_id WHERE u.owner_id = s.owner_id AND e.charge_to = 'owner'
        AND NOT e.record_only AND e.deduct_month = substr(s.period_start, 1, 7) AND e.created_at::timestamptz > s.generated_at::timestamptz
        AND NOT EXISTS (SELECT 1 FROM statement_lines l WHERE l.statement_id = s.id AND l.expense_id = e.id))`, JSON.stringify(b.statementIds))).map(r => r.id));
  const ok = rows.filter(r => r.state === 'provisional' && !stale.has(r.id));
  const failed = b.statementIds.filter(id => !ok.some(r => r.id === id)).map(id => ({ id, reason: stale.has(id)
    ? 'A bill was added after this draft was made. Generate the statement again, then mark it final.'
    : rows.find(r => r.id === id) ? 'Only a draft statement can be marked final.' : 'That statement no longer exists.' }));

  const now = nowIso();
  // Two writes for the whole selection, not two per statement: a month is about 100 owners.
  if (ok.length) {
    const ids = JSON.stringify(ok.map(r => r.id));
    await run(env, "UPDATE owner_statements SET state = 'finalised', finalised_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state = 'provisional'", now, ids);
    await auditMany(env, ok.map(r => ({ actorId: session.userId, actorLabel: session.fullName, action: 'statement.finalise', entityTable: 'owner_statements', entityId: r.id, before: { state: 'provisional' }, after: { state: 'finalised' } })));
  }
  return json({ finalised: ok.length, failed });
};
