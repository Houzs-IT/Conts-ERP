/** What holds a lock back (Unit report click-to-lock, spec docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md
 *  goal 4 and the builder check answers, 13 Nov 2026): only Revenue can be held back, by the month's own Airbnb
 *  reconciliation lines still to confirm. A blank or zero amount never holds a lock back (chew: "别因为空白或没数额就不让锁").
 *
 *  Routes read this and hand it to lockStage (functions/_lib/ownerLocks.ts): the reconciliation module imports
 *  ownerLocks, so ownerLocks must not import this file. */
import { type Env, all, mytToday } from './db';
import { hasAirbnbRecon, loadMonth } from '../api/airbnb-recon/index';

/** The month's own reconciliation lines still to confirm, counted by the units of their reservation (a line matched to
 *  no reservation holds nothing back), and how many Airbnb files the month has (0: nothing holds Revenue back, and the
 *  screens say no file is uploaded yet). Before migration 0258 there is no reconciliation: nothing is held back. */
export async function unconfirmedRevenue(env: Env, month: string): Promise<{ byUnit: Map<string, number>; files: number }> {
  const byUnit = new Map<string, number>();
  if (!(await hasAirbnbRecon(env))) return { byUnit, files: 0 };
  const [recon, decided, files] = await Promise.all([
    loadMonth(env, month, mytToday()),
    all<{ code: string }>(env, 'SELECT code FROM airbnb_recon_decisions WHERE month = ?', month),
    all<{ n: number }>(env, 'SELECT count(*)::int AS n FROM airbnb_recon_files WHERE month = ?', month),
  ]);
  const done = new Set(decided.map(d => d.code));
  for (const l of recon.recon.lines) {
    if (!l.needsConfirm || done.has(l.code)) continue;
    for (const unitId of new Set(l.stays.map(s => s.unitId))) byUnit.set(unitId, (byUnit.get(unitId) ?? 0) + 1);
  }
  return { byUnit, files: Number(files[0]?.n ?? 0) };
}
