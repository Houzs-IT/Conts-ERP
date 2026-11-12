import { type Env, all, run, json, fail, nowIso } from '../../_lib/db';
import { auditMany } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { finalReadiness } from '../../_lib/ownerLocks';
import { LOCK_FROM, finalWaiting, waitingText } from '../../_lib/stageLocks';

/** POST /api/statements/finalise { statementIds } — provisional → finalised. From then on the figures are frozen, owners can see them, and they can be sent.
 *  Anything not provisional is named in `failed` and left alone. Make final is a power given one by one (makeFinal), and
 *  from October 2026 an owner's statement is made final only once every step that lists one of the owner's units is
 *  locked (owner statement close part 3, spec goal 7). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'makeFinal', 'edit')) return fail('FORBIDDEN', 'Your access does not include Make final.', 403);

  const b = await request.json<{ statementIds: string[] }>().catch(() => null);
  if (!Array.isArray(b?.statementIds) || !b.statementIds.length || b.statementIds.length > 200) return fail('VALIDATION', 'Select at least one statement.', 422);

  const rows = await all<{ id: string; state: string; owner_id: string; period_start: string }>(env,
    `SELECT id, state, owner_id, period_start FROM owner_statements WHERE id IN (${b.statementIds.map(() => '?').join(',')})`, ...b.statementIds);
  // A bill the owner pays that was added after the draft was made (a late utility bill rolls onto the next open
  // month, which is often a draft already): finalising the draft as it stands would leave the bill on no statement.
  const stale = new Set((await all<{ id: string }>(env, `
    SELECT s.id FROM owner_statements s WHERE s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND s.state = 'provisional'
      AND EXISTS (SELECT 1 FROM expenses e JOIN units u ON u.id = e.unit_id WHERE u.owner_id = s.owner_id AND e.charge_to = 'owner'
        AND NOT e.record_only AND e.deduct_month = substr(s.period_start, 1, 7) AND e.created_at::timestamptz > s.generated_at::timestamptz
        AND NOT EXISTS (SELECT 1 FROM statement_lines l WHERE l.statement_id = s.id AND l.expense_id = e.id))`, JSON.stringify(b.statementIds))).map(r => r.id));
  // An owner adjustment the draft prints that changed or went since it was made (a late income difference brought up
  // to date by Owner statement close, an unlock, an edit on the owner's page): finalising the draft as it stands would
  // pay what it prints while the books hold another amount. A deleted adjustment leaves its line with none.
  const adjusted = new Set((await all<{ id: string }>(env, `
    SELECT s.id FROM owner_statements s WHERE s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND s.state = 'provisional'
      AND EXISTS (SELECT 1 FROM statement_lines l WHERE l.statement_id = s.id AND (
        (l.adjustment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM owner_adjustments a WHERE a.id = l.adjustment_id AND a.statement_id = s.id AND a.amount = l.amount))
        OR (l.adjustment_id IS NULL AND l.category IN ('owner_credit', 'owner_charge'))))`, JSON.stringify(b.statementIds))).map(r => r.id));
  // A step still open for one of the owner's units (a month from October 2026; earlier months are imported and paid).
  const waiting = new Map<string, string>();
  const drafts = rows.filter(r => r.state === 'provisional' && !stale.has(r.id) && !adjusted.has(r.id) && r.period_start.slice(0, 7) >= LOCK_FROM);
  for (const month of [...new Set(drafts.map(r => r.period_start.slice(0, 7)))]) {
    const ready = await finalReadiness(env, month);
    for (const s of drafts.filter(r => r.period_start.startsWith(month))) {
      const units = ready.get(s.owner_id) ?? [];
      const open = finalWaiting(units);
      if (open.length) waiting.set(s.id, `${waitingText(open, units.length)}. Lock every step on Owner statement close before marking it final.`);
    }
  }
  const ok = rows.filter(r => r.state === 'provisional' && !stale.has(r.id) && !adjusted.has(r.id) && !waiting.has(r.id));
  const failed = b.statementIds.filter(id => !ok.some(r => r.id === id)).map(id => ({ id, reason: stale.has(id)
    ? 'A bill was added after this draft was made. Generate the statement again, then mark it final.'
    : adjusted.has(id) ? 'An owner adjustment changed after this draft was made. Generate the statement again, then mark it final.'
    : waiting.get(id) ?? (rows.find(r => r.id === id) ? 'Only a draft statement can be marked final.' : 'That statement no longer exists.') }));

  const now = nowIso();
  // Two writes for the whole selection, not two per statement: a month is about 100 owners.
  if (ok.length) {
    const ids = JSON.stringify(ok.map(r => r.id));
    await run(env, "UPDATE owner_statements SET state = 'finalised', finalised_at = ? WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state = 'provisional'", now, ids);
    await auditMany(env, ok.map(r => ({ actorId: session.userId, actorLabel: session.fullName, action: 'statement.finalise', entityTable: 'owner_statements', entityId: r.id, before: { state: 'provisional' }, after: { state: 'finalised' } })));
  }
  return json({ finalised: ok.length, failed });
};
