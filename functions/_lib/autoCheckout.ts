import { type Env, all, run, nowIso, mytToday } from './db';

/** A stay whose checkout date has passed but which nobody moved off "checked in" (11 Oct 2026: 17 such stays on
 *  production, all due out on 10 Oct; imports and channel syncs set checked_in and nothing ever moved them on).
 *  Only the state changes: the unit is not marked dirty and no clean is created, because the guest left on an earlier
 *  day and that clean is past. A checkout due today is left to staff, whose Check out does both. */
export async function closePastStays(env: Env) {
  const today = mytToday();
  const moved = await all<{ id: string; check_out: string }>(env, `
    UPDATE reservations SET state = 'checked_out', updated_at = ?
    WHERE state = 'checked_in' AND check_out < ?
    RETURNING id, check_out`, nowIso(), today);
  if (moved.length) {
    // One insert for the whole batch, the same row audit() writes for each.
    const rows = moved.map(r => ({ id: r.id, after: JSON.stringify({ state: 'checked_out', reason: `Checkout date ${r.check_out} has passed` }) }));
    await run(env, `
      INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, before_state, after_state, source, occurred_at)
      SELECT NULL, 'System', 'reservation.status', 'reservations', x.id, ?, x.after, 'system', ?
      FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, after text)`,
      JSON.stringify({ state: 'checked_in' }), nowIso(), JSON.stringify(rows));
  }
  return moved.length;
}

let lastRun = 0;
/** At most every 15 minutes per Worker instance, after a response has gone out. There is no scheduled worker on
 *  production yet, so the API's own traffic carries this. */
export function closePastStaysSometimes(env: Env, waitUntil: (p: Promise<unknown>) => void) {
  const now = Date.now();
  if (now - lastRun < 15 * 60_000) return;
  lastRun = now;
  waitUntil(closePastStays(env).catch(() => { lastRun = 0; }));
}
