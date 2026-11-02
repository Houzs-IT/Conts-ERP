import { type Env, audit } from './db';
import { queueNights } from './channexQueue';
import { unitsInState } from './holidays';

/** After a public holiday is added, moved or removed: re-queue the prices of those nights (and the nights before them,
 *  for units that price holiday eves) for every unit the holiday applies to, so Channex gets the holiday price, or
 *  the normal price again. The whole thing, lookups included, is wrapped: a queue problem is audited and never fails
 *  the holiday save. Returns how many units were queued, or null when queueing failed. */
export async function requeueForHolidays(env: Env, changes: { date: string; state: string | null }[], source: string): Promise<number | null> {
  try {
    const byUnit = new Map<string, Set<string>>();
    for (const state of [...new Set(changes.map(c => c.state))]) {
      const dates = changes.filter(c => c.state === state).map(c => c.date);
      for (const id of await unitsInState(env, state)) {
        const set = byUnit.get(id) ?? new Set<string>();
        dates.forEach(d => set.add(d));
        byUnit.set(id, set);
      }
    }
    // Units with the same nights go in one call (a holiday for every state is every unit with the same dates).
    const groups = new Map<string, string[]>();
    for (const [id, dates] of byUnit) { const key = [...dates].sort().join(','); groups.set(key, [...(groups.get(key) ?? []), id]); }
    let units = 0;
    for (const [key, ids] of groups) units += (await queueNights(env, ids, key.split(','))).units;
    return units;
  } catch (e) {
    // vocab-ok: stored History actor name, the same one every Channex writer records
    await audit(env, { actorId: null, actorLabel: 'Channex', action: 'channex.enqueue_failed', entityTable: 'public_holidays', entityId: source, after: { changes, error: e instanceof Error ? e.message : String(e) } }).catch(() => {});
    return null;
  }
}
