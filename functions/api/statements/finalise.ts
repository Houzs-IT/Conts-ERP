import { type Env, all, one, json, fail, nowIso, transaction } from '../../_lib/db';
import { auditMany } from '../../_lib/history';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { finalReadiness, LATE_INCOME_LOCK } from '../../_lib/ownerLocks';
import { LOCK_FROM, STAGES, finalWaiting, waitingText, type FinalUnit } from '../../_lib/stageLocks';

/** POST /api/statements/finalise { statementIds } — provisional → finalised. From then on the figures are frozen, owners can see them, and they can be sent.
 *  Anything not provisional is named in `failed` and left alone. Make final is a power given one by one (makeFinal), and
 *  from October 2026 an owner's statement is made final only once every step that lists one of the owner's units is
 *  locked (owner statement close part 3, spec goal 7), from a draft made after those locks and after any Unlock final. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'makeFinal', 'edit')) return fail('FORBIDDEN', 'Your access does not include Make final.', 403);

  const b = await request.json<{ statementIds: string[] }>().catch(() => null);
  if (!Array.isArray(b?.statementIds) || !b.statementIds.length) return fail('VALIDATION', 'Select at least one statement.', 422);
  // The Unit report's Final "Lock all" sends owners in batches under this (src/lib/finalBatches.ts FINALISE_LIMIT).
  if (b.statementIds.length > 200) return fail('VALIDATION', 'Select up to 200 statements at a time.', 422);

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
  const ready = new Map<string, FinalUnit[]>(); // statement id → the owner's units on the month's steps
  const drafts = rows.filter(r => r.state === 'provisional' && !stale.has(r.id) && !adjusted.has(r.id) && r.period_start.slice(0, 7) >= LOCK_FROM);
  for (const month of [...new Set(drafts.map(r => r.period_start.slice(0, 7)))]) {
    const byOwner = await finalReadiness(env, month);
    for (const s of drafts.filter(r => r.period_start.startsWith(month))) {
      const units = byOwner.get(s.owner_id) ?? [];
      ready.set(s.id, units);
      const open = finalWaiting(units);
      if (open.length) waiting.set(s.id, `${waitingText(open, units.length)}. Lock every category on the Unit report before marking it final.`);
    }
  }
  // A draft made before the owner's latest lock, or before Unlock final, may print figures the locks do not hold: a change
  // made between the draft and the lock would then be on no statement, and the late update sees nothing to move (review C1).
  const lockedDrafts = drafts.filter(r => !waiting.has(r.id));
  const staleDraft = new Set(lockedDrafts.length ? (await all<{ id: string }>(env, `
    SELECT s.id FROM owner_statements s WHERE s.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      AND (EXISTS (SELECT 1 FROM owner_report_locks l JOIN units u ON u.id = l.unit_id
             WHERE u.owner_id = s.owner_id AND l.month = substr(s.period_start, 1, 7) AND l.locked_at::timestamptz > s.generated_at::timestamptz)
        OR EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_table = 'owner_statements' AND a.entity_id = s.id AND a.action = 'statement.unlock_final'
             AND a.occurred_at::timestamptz > s.generated_at::timestamptz))`, JSON.stringify(lockedDrafts.map(r => r.id)))).map(r => r.id) : []);
  const candidates = rows.filter(r => r.state === 'provisional' && !stale.has(r.id) && !adjusted.has(r.id) && !waiting.has(r.id) && !staleDraft.has(r.id));

  // Made final under the late update's lock, which Unlock a step takes too: a step unlocked while the readiness above was
  // worked out is seen here, and refuses its statement, instead of leaving a final month with a step open (review I3).
  const now = nowIso();
  const done = await transaction(env, async tx => {
    await one(tx, 'SELECT 1 AS x FROM (SELECT pg_advisory_xact_lock(hashtext(?::text))) k', LATE_INCOME_LOCK);
    const checked = candidates.filter(r => ready.has(r.id));
    if (checked.length) {
      const unitIds = [...new Set(checked.flatMap(r => ready.get(r.id)!.map(u => u.unitId)))];
      const held = new Set((await all<{ unit_id: string; month: string; stage: string }>(tx,
        `SELECT unit_id, month, stage FROM owner_report_locks WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(unitIds)))
        .map(l => `${l.unit_id}|${l.month}|${l.stage}`));
      for (const r of checked) {
        const month = r.period_start.slice(0, 7);
        const units = ready.get(r.id)!.map(u => ({ ...u, locked: STAGES.filter(s => held.has(`${u.unitId}|${month}|${s}`)) }));
        const open = finalWaiting(units);
        if (open.length) waiting.set(r.id, `${waitingText(open, units.length)}. Lock every category on the Unit report before marking it final.`);
      }
    }
    const go = candidates.filter(r => !waiting.has(r.id));
    if (!go.length) return [];
    // Two writes for the whole selection, not two per statement: a month is about 100 owners.
    const made = (await all<{ id: string }>(tx, `UPDATE owner_statements SET state = 'finalised', finalised_at = ?
      WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND state = 'provisional' RETURNING id`, now, JSON.stringify(go.map(r => r.id)))).map(r => r.id);
    if (made.length) {
      await auditMany(tx, made.map(id => ({ actorId: session.userId, actorLabel: session.fullName, action: 'statement.finalise', entityTable: 'owner_statements', entityId: id, before: { state: 'provisional' }, after: { state: 'finalised' } })));
    }
    return made;
  });
  const failed = b.statementIds.filter(id => !done.includes(id)).map(id => ({ id, reason: stale.has(id)
    ? 'A bill was added after this draft was made. Generate the statement again, then mark it final.'
    : adjusted.has(id) ? 'An owner adjustment changed after this draft was made. Generate the statement again, then mark it final.'
    : waiting.get(id) ?? (staleDraft.has(id) ? 'A step was locked, or the statement unlocked, after this draft was made. Generate the statement again, then mark it final.'
    : rows.find(r => r.id === id) ? 'Only a draft statement can be marked final.' : 'That statement no longer exists.') }));
  return json({ finalised: done.length, failed });
};
