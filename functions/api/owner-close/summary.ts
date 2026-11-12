import { type Env, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { monthSteps } from '../../_lib/ownerLocks';
import { unconfirmedRevenue } from '../../_lib/lockReadiness';
import { anyLockPower, lockMay } from '../../_lib/lockPowers';
import { lockMonthProblem, notReadyText } from '../../_lib/stageLocks';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const previousMonth = (m: string) => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };

/** GET /api/owner-close/summary?month=2026-10 — the month's locks for the lock bars on the work pages (Airbnb
 *  reconciliation, Utility bills, Deductions; spec goal 5): per category how many of the units it lists are locked,
 *  the units whose Revenue waits for Airbnb reservations to be confirmed, how many Airbnb files the month has, why the
 *  month cannot be locked (if so), and what this person may do. Anyone with a lock power or Unlock a step reads it, and
 *  finance and management (spec, builder check answers). Without a month: last month (MYT). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage && !anyLockPower(session)) return fail('FORBIDDEN', "Your access does not include the month's locks.", 403);
  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : previousMonth(today.slice(0, 7));

  const [step, revenue] = await Promise.all([monthSteps(env, month), unconfirmedRevenue(env, month)]);
  const unitOf = new Map(step.inputs.units.map(u => [u.id, u]));
  const notReady = step.steps.income.filter(id => !step.locks.get(id)?.income && (revenue.byUnit.get(id) ?? 0) > 0).map(id => {
    const u = unitOf.get(id);
    return { unitId: id, label: u ? `${u.property_name} ${u.unit_number}` : id, reason: notReadyText(revenue.byUnit.get(id) ?? 0)! };
  });
  return json({ month, lockProblem: lockMonthProblem(month, today), airbnbFiles: revenue.files, counts: step.counts, notReady, may: lockMay(session) });
};
