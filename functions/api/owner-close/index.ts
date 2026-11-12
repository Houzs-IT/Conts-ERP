import { type Env, all, json, fail, mytToday } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { can } from '../../_lib/access';
import { closeSteps } from '../../_lib/ownerLocks';
import { lockMonthProblem, deductionChecks, o2Checks, monthLabel, STAGES, type Stage } from '../../_lib/stageLocks';
import { monthEndExclusive } from '../../_lib/revenue';
import { hasAirbnbRecon, loadMonth } from '../airbnb-recon/index';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const previousMonth = (m: string) => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };

export interface CloseUnit {
  unitId: string; building: string; unit: string; ownerName: string;
  /** The owner's statement for the month is final: a unit not locked by then cannot be locked any more. */
  statementFinal: boolean;
  /** The steps that list this unit: income and deductions on a share contract, O2 for every unit on the statement. */
  steps: Stage[];
  income: { reservations: number; nights: number; amount: number; toConfirm: number; warnings: string[] };
  deductions: { cleaning: number; utilities: number; additional: number; misc: number; total: number; checks: string[] };
  o2: { credits: number; charges: number; net: number; checks: string[] };
  locks: Record<Stage, { by: string; at: string } | null>;
}

const CLEANING = ['cleaning_basic', 'cleaning_deep'], UTILITIES = ['electricity', 'water', 'internet', 'sewerage'];
/** An owner adjustment's description as the statement prints it (without a leading 'O2:'), for comparing two months. */
const said = (d: string) => d.replace(/^O2:\s*/i, '').trim().toLowerCase();

/** GET /api/owner-close?month=2026-10 — Owner statement close (chew, 11 Nov 2026; spec
 *  docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md): every unit on one of the month's steps, with
 *  its figures as the statements work them out (from what a lock kept, where a step is locked), what still needs a
 *  look, and each step's lock, by whom and when.
 *    income       units on a share contract with something in the month; toConfirm: the Airbnb reconciliation lines of
 *                 the month still to confirm whose reservation is on the unit.
 *    deductions   the same units: cleaning, utilities, additional deductions and the misc charge.
 *    o2           every unit on the month's statement: the owner adjustments a statement built now takes for it.
 *  final: step 4 (GP and final, part 3): how many owners have a unit on one of the month's steps, and how many of them
 *  have their statement final.
 *  Without a month: last month (MYT). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!can(session, 'ownerClose', 'view')) return fail('FORBIDDEN', 'Your access does not include Owner statement close.', 403);
  const today = mytToday();
  const asked = new URL(request.url).searchParams.get('month') ?? '';
  const month = MONTH.test(asked) ? asked : previousMonth(today.slice(0, 7));

  const [step, recon] = await Promise.all([
    closeSteps(env, month),
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

  const start = `${month}-01`, endEx = monthEndExclusive(month);
  const monthEnd = new Date(Date.parse(`${endEx}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const prev = previousMonth(month);
  const prevName = monthLabel(prev).split(' ')[0];
  const unitsById = new Map(step.inputs.units.map(u => [u.id, u]));
  const openOf = new Map(step.open.map(r => [r.unitId, r]));
  const onStep = new Map<string, Stage[]>();
  for (const stage of STAGES) for (const id of step.steps[stage]) onStep.set(id, [...(onStep.get(id) ?? []), stage]);
  // The owner adjustments dated in the month before, by owner and unit (a no-unit one matches any unit of its owner): one
  // with the same amount and description this month may be a repeat.
  const before = new Set<string>();
  for (const a of step.inputs.adjustments) {
    if (a.occurred_on.slice(0, 7) !== prev) continue;
    before.add(`${a.owner_id}|${a.unit_id ?? ''}|${Number(a.amount)}|${said(a.description)}`);
  }

  const units: CloseUnit[] = step.dated.filter(r => onStep.has(r.unitId)).map(r => {
    const u = unitsById.get(r.unitId)!;
    const locks = step.locks.get(r.unitId) ?? {};
    const group = (cats: string[]) => r.deductionGroups.filter(g => cats.includes(g.category)).reduce((n, g) => n + g.amount, 0);
    const cleaning = group(CLEANING), utilities = group(UTILITIES);
    const checkouts = step.inputs.stays.filter(s => s.unit_id === r.unitId && s.check_out >= start && s.check_out < endEx).length;
    const o = openOf.get(r.unitId);
    const o2Lines = (o?.lines ?? []).filter(l => l.type === 'adjustment' && (l.category === 'owner_credit' || l.category === 'owner_charge'));
    const credits = o2Lines.filter(l => l.amount > 0).reduce((n, l) => n + l.amount, 0);
    const charges = o2Lines.filter(l => l.amount < 0).reduce((n, l) => n - l.amount, 0);
    const same = (unitId: string, l: { amount: number; description: string }) => before.has(`${r.ownerId}|${unitId}|${l.amount}|${said(l.description)}`);
    const repeats = o2Lines.filter(l => same(r.unitId, l) || same('', l)).length;
    return {
      unitId: r.unitId, building: u.property_name, unit: u.unit_code || u.unit_number, ownerName: u.owner_name,
      statementFinal: step.finals.has(r.ownerId),
      steps: onStep.get(r.unitId) ?? [],
      income: {
        reservations: r.lines.filter(x => x.type === 'gross' && x.category === 'hospitality').length,
        nights: r.nights, amount: r.gross, toConfirm: toConfirm.get(r.unitId) ?? 0, warnings: r.warnings,
      },
      deductions: {
        cleaning, utilities, additional: group(['additional']), misc: group(['misc']), total: r.deductions,
        checks: deductionChecks({ checkouts, cleaning, utilities, contractEnd: r.terms.activeTo, monthEnd }),
      },
      o2: { credits, charges, net: credits - charges, checks: o2Checks({ held: step.held.get(r.unitId) ?? 0, repeats, prevMonth: prevName }) },
      locks: Object.fromEntries(STAGES.map(s => [s, locks[s] ? { by: locks[s]!.locked_by_name, at: locks[s]!.locked_at } : null])) as CloseUnit['locks'],
    };
  }).sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit));

  const stepOwners = new Set(step.dated.filter(r => onStep.has(r.unitId)).map(r => r.ownerId));
  return json({
    month, today, lockProblem: lockMonthProblem(month, today),
    may: {
      lockIncome: can(session, 'lockIncome', 'edit'), lockDeductions: can(session, 'lockDeductions', 'edit'), lockO2: can(session, 'lockO2', 'edit'),
      unlock: can(session, 'unlockStep', 'edit'), makeFinal: can(session, 'makeFinal', 'edit'),
    },
    final: { final: [...stepOwners].filter(id => step.finals.has(id)).length, total: stepOwners.size },
    airbnbFiles: recon?.files.length ?? 0,
    counts: step.counts,
    units,
  });
};
