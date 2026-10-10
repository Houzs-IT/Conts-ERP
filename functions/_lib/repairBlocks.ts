import { type Env, all, run, audit, nowIso } from './db';
import { findClash } from './reservations';
import { syncAvailabilityIfLinked } from './channexSync';

const mytDay = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

export interface ReleasedBlock { reservationId: string; unitId: string; issueId: string; from: string; to: string; action: 'cancelled' | 'shortened' }

/** The calendar blocks a repair job still holds from today on: the ones linked to it (migration 0095), and,
 *  for blocks made before that link existed, the one "Block unit until fixed" wrote for it — same unit, the
 *  note it writes ("Maintenance: <title>"), made after the job was reported. */
export async function repairBlocksHeld(env: Env, issueIds?: string[]): Promise<{ id: string; unit_id: string; check_in: string; check_out: string; issue_id: string }[]> {
  const today = mytDay();
  const scope = issueIds ? 'm.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : "m.state = 'resolved'";
  const args = issueIds ? [JSON.stringify(issueIds)] : [];
  const linked = await all<any>(env, `
    SELECT r.id, r.unit_id, r.check_in, r.check_out, m.id AS issue_id
    FROM reservations r JOIN maintenance_issues m ON m.id = r.maintenance_issue_id
    WHERE ${scope} AND r.channel = 'maintenance_block' AND r.state NOT IN ('cancelled','no_show') AND r.check_out > ?`, ...args, today)
    .catch(() => [] as any[]); // before migration 0095 the column is not there; the note match below still runs
  const legacy = await all<any>(env, `
    SELECT r.id, r.unit_id, r.check_in, r.check_out, m.id AS issue_id
    FROM maintenance_issues m JOIN reservations r ON r.unit_id = m.unit_id
    WHERE ${scope} AND r.channel = 'maintenance_block' AND r.state NOT IN ('cancelled','no_show') AND r.check_out > ?
      AND r.notes = left('Maintenance: ' || m.title, 200) AND r.created_at >= m.created_at`, ...args, today);
  const seen = new Set<string>();
  return [...linked, ...legacy].filter(r => !seen.has(r.id) && seen.add(r.id));
}

/** Gives back the nights a finished repair job no longer needs: a block that has not started is cancelled, one
 *  under way ends today. Past nights stay as they were. The booking sites are told the nights are free unless
 *  another stay holds them. Never throws: a failure is audited and the job's own close stands. */
export async function releaseRepairBlocks(env: Env, issueIds: string[] | undefined, actor: { id: string | null; label: string }, dryRun = false): Promise<ReleasedBlock[]> {
  const out: ReleasedBlock[] = [];
  try {
    const today = mytDay();
    for (const b of await repairBlocksHeld(env, issueIds)) {
      const action: ReleasedBlock['action'] = b.check_in >= today ? 'cancelled' : 'shortened';
      const from = action === 'cancelled' ? b.check_in : today;
      out.push({ reservationId: b.id, unitId: b.unit_id, issueId: b.issue_id, from, to: b.check_out, action });
      if (dryRun) continue;
      const now = nowIso();
      if (action === 'cancelled') await run(env, `UPDATE reservations SET state = 'cancelled', updated_at = ? WHERE id = ?`, now, b.id);
      else await run(env, `UPDATE reservations SET check_out = ?, updated_at = ? WHERE id = ?`, today, now, b.id);
      await audit(env, {
        actorId: actor.id, actorLabel: actor.label, action: 'reservation.block_released', entityTable: 'reservations', entityId: b.id,
        before: action === 'cancelled' ? { state: 'confirmed' } : { checkOut: b.check_out },
        after: { ...(action === 'cancelled' ? { state: 'cancelled' } : { checkOut: today }), reason: 'repair job closed', maintenanceIssueId: b.issue_id },
        source: actor.id ? 'web' : 'system',
      });
      await audit(env, {
        actorId: actor.id, actorLabel: actor.label, action: 'maintenance.block_released', entityTable: 'maintenance_issues', entityId: b.issue_id,
        after: { blockFrom: from, blockTo: b.check_out, released: action }, source: actor.id ? 'web' : 'system',
      });
      try {
        if (!(await findClash(env, b.unit_id, from, b.check_out, b.id))) await syncAvailabilityIfLinked(env, b.unit_id, from, b.check_out, true);
      } catch { /* the outbox records its own failures; the block is released either way */ }
    }
  } catch (e) {
    await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'maintenance.block_release_failed', entityTable: 'maintenance_issues', entityId: issueIds?.[0] ?? 'sweep', after: { error: e instanceof Error ? e.message : String(e) }, source: 'system' }).catch(() => {});
  }
  return out;
}
