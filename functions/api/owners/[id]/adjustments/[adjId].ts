import { type Env, one, json, fail, audit, nowIso } from '../../../../_lib/db';
import { requireSession } from '../../../../_lib/auth';
import { mayChangeAdjustments } from '../../../../_lib/ownerScope';

const LOCKED = ['finalised', 'sent', 'paid'];

/** PATCH /api/owners/:id/adjustments/:adjId { action, month?, note? } — one person's deliberate change of state.
 *  Nothing here runs on its own: a held debt stays held until someone releases it.
 *    release  held -> open. `month` (YYYY-MM, optional) dates it to that month's first day, so the statement
 *             generated for that month deducts it; without it the original date stands (the first month
 *             ending after it). A month whose statement for this owner is already final is refused.
 *    hold     open -> held. Not once a final statement carries it.
 *    settle   open or held -> settled, paid outside Property OS; `note` says where. Not once a final statement carries it.
 *  When a provisional statement carried the adjustment, holding or settling takes it off that statement's list:
 *  regenerate the month to rebuild the statement's lines. */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayChangeAdjustments(session)) return fail('FORBIDDEN', 'Only management, finance and operations managers can change owner adjustments.', 403);
  const ownerId = String(params.id), id = String(params.adjId);

  const cur = await one<{ state: string; occurred_on: string; statement_id: string | null; statement_state: string | null; period_start: string | null }>(env, `
    SELECT a.state, a.occurred_on, a.statement_id, s.state AS statement_state, s.period_start
    FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id WHERE a.id = ? AND a.owner_id = ?`, id, ownerId);
  if (!cur) return fail('NOT_FOUND', 'That adjustment no longer exists.', 404);

  const b = await request.json<any>().catch(() => null);
  const action = b?.action;
  const now = nowIso();
  const onFinal = !!cur.statement_id && LOCKED.includes(cur.statement_state ?? '');
  const regenerate = cur.statement_id && !onFinal ? String(cur.period_start).slice(0, 7) : null;

  if (action === 'release') {
    if (cur.state !== 'held') return fail('WRONG_STATE', 'Only a held adjustment can be released.', 409);
    let occurredOn = cur.occurred_on;
    if (b?.month !== undefined && b.month !== null && b.month !== '') {
      const month = String(b.month);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Pick the statement month.', 422, { month: 'Pick the statement month.' });
      const locked = await one(env, `SELECT 1 AS x FROM owner_statements WHERE owner_id = ? AND period_start = ? AND state IN ('finalised','sent','paid')`, ownerId, `${month}-01`);
      if (locked) return fail('PERIOD_LOCKED', 'That month\'s statement for this owner is already final. Pick a later month.', 409, { month: 'Already final.' });
      occurredOn = `${month}-01`;
    }
    const done = await one(env, `UPDATE owner_adjustments SET state = 'open', occurred_on = ?, statement_id = NULL, updated_at = ? WHERE id = ? AND state = 'held' RETURNING id`, occurredOn, now, id);
    if (!done) return fail('WRONG_STATE', 'Someone else changed this adjustment. Reload and try again.', 409);
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'owner_adjustment.release', entityTable: 'owner_adjustments', entityId: id,
      before: { state: 'held', occurredOn: cur.occurred_on }, after: { state: 'open', occurredOn } });
    return json({ ok: true, state: 'open', occurredOn });
  }

  if (action === 'hold' || action === 'settle') {
    const allowed = action === 'hold' ? ['open'] : ['open', 'held'];
    if (!allowed.includes(cur.state)) return fail('WRONG_STATE', action === 'hold' ? 'Only an open adjustment can be held.' : 'This adjustment is already settled.', 409);
    if (onFinal) return fail('ON_FINAL_STATEMENT', `The ${String(cur.period_start).slice(0, 7)} statement already carries this adjustment and is final.`, 409);
    const note = String(b?.note ?? '').trim();
    if (action === 'settle' && (!note || note.length > 300)) return fail('VALIDATION', 'Say where it was settled, in up to 300 characters.', 422, { note: 'Say where it was settled.' });
    const to = action === 'hold' ? 'held' : 'settled';
    const done = await one(env, `UPDATE owner_adjustments SET state = ?, statement_id = NULL, settled_note = ?, updated_at = ? WHERE id = ? AND state = ? RETURNING id`,
      to, action === 'settle' ? note : null, now, id, cur.state);
    if (!done) return fail('WRONG_STATE', 'Someone else changed this adjustment. Reload and try again.', 409);
    // The note can name people or accounts, so the audit records only that one was given.
    await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: `owner_adjustment.${action}`, entityTable: 'owner_adjustments', entityId: id,
      before: { state: cur.state, statementId: cur.statement_id }, after: { state: to, ...(action === 'settle' ? { noted: true } : {}) } });
    return json({ ok: true, state: to, regenerate });
  }

  return fail('VALIDATION', 'Unknown action. Use release, hold or settle.', 422);
};
