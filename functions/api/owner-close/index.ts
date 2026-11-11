import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { incomeStep } from '../../_lib/ownerLocks';
import { lockMonthProblem } from '../../_lib/stageLocks';
import { hasAirbnbRecon, loadMonth } from '../airbnb-recon/index';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const previousMonth = (m: string) => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };

export interface CloseUnit {
  unitId: string; building: string; unit: string; ownerName: string;
  reservations: number; nights: number; income: number; toConfirm: number; warnings: string[];
  incomeLock: { by: string; at: string } | null;
  /** The owner's statement for the month is final: a unit not locked by then cannot be locked any more. */
  statementFinal: boolean;
}

/** GET /api/owner-close?month=2026-10 — Owner statement close (chew, 11 Nov 2026; spec
 *  docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md): every unit on the month's income step (with
 *  anything in the month's owner statement, and not on a fixed rent or a master lease, whose owner is paid the same
 *  whatever the unit earns), with its income as the statements work it out (from what a lock kept, where the income is
 *  locked), what still needs a look, and whether its income is locked, by whom and when. Without a month: last month
 *  (MYT). toConfirm: the Airbnb reconciliation lines of the month still to confirm whose reservation is on the unit. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'ownerClose', 'view')) return fail('FORBIDDEN', 'Your access does not include Owner statement close.', 403);
  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : previousMonth(today.slice(0, 7));

  const [step, recon] = await Promise.all([
    incomeStep(env, month),
    hasAirbnbRecon(env).then(ready => (ready ? loadMonth(env, month, today) : null)),
  ]);

  // Reconciliation lines still to confirm, by the unit of their reservation (a decided line no longer counts).
  const toConfirm = new Map<string, number>();
  if (recon) {
    const decided = new Set((await all<{ code: string }>(env, 'SELECT code FROM airbnb_recon_decisions WHERE month = ?', month)).map(d => d.code));
    for (const l of recon.recon.lines) {
      if (!l.needsConfirm || decided.has(l.code)) continue;
      for (const unitId of new Set(l.stays.map(s => s.unitId))) toConfirm.set(unitId, (toConfirm.get(unitId) ?? 0) + 1);
    }
  }
  const unitsById = new Map(step.inputs.units.map(u => [u.id, u]));
  const units: CloseUnit[] = step.rows.map(r => {
    const u = unitsById.get(r.unitId)!;
    const lock = step.locks.get(r.unitId);
    return {
      unitId: r.unitId, building: u.property_name, unit: u.unit_code || u.unit_number, ownerName: u.owner_name,
      reservations: r.lines.filter(x => x.type === 'gross' && x.category === 'hospitality').length,
      nights: r.nights, income: r.gross, toConfirm: toConfirm.get(r.unitId) ?? 0, warnings: r.warnings,
      incomeLock: lock ? { by: lock.locked_by_name, at: lock.locked_at } : null,
      statementFinal: step.finals.has(r.ownerId),
    };
  }).sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit));

  return json({
    month, today, lockProblem: lockMonthProblem(month, today),
    may: { lockIncome: can(session, 'lockIncome', 'edit'), unlock: can(session, 'unlockStep', 'edit') },
    airbnbFiles: recon?.files.length ?? 0,
    counts: { income: step.counts },
    units,
  });
};
