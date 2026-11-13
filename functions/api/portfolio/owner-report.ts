import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, withYearToDate, computeMonth, statementSettings, hasActivity, unitForMonth, type Query, type UnitRow, type UnitMonth } from '../../_lib/ownerStatement';
import { unitCode } from '../../_lib/ownerReport';
import { isTenancy, type RevenueModel } from '../../_lib/revenueModel';
import { codeOf } from '../../_lib/unitPurpose';
import { contractTypes } from '../../_lib/contractTypes';
import { monthEndExclusive } from '../../_lib/revenue';
import { companyLateFor, finalReadiness, monthSteps } from '../../_lib/ownerLocks';
import { unconfirmedRevenue } from '../../_lib/lockReadiness';
import { lockMay } from '../../_lib/lockPowers';
import { can } from '../../_lib/access';
import { PLACEHOLDER_OWNER } from '../../_lib/hostplatformImport';
import {
  LOCK_FROM, STAGES, finalWaiting, waitingText, cleaningChecks, utilitiesChecks, o2Checks, notReadyText, monthLabel, lockMonthProblem, type FinalUnit, type Stage,
} from '../../_lib/stageLocks';
import type { ReportGroup } from '../../../src/lib/ownerOverall';

const rmText = (sen: number) => `RM ${(sen / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BILL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };
const previousMonth = (m: string) => { const [y, n] = m.split('-').map(Number); return n === 1 ? `${y - 1}-12` : `${y}-${String(n - 1).padStart(2, '0')}`; };
/** An owner adjustment's description as the statement prints it, for comparing two months. */
const said = (d: string) => d.replace(/^O2:\s*/i, '').trim().toLowerCase();
/** A list in a hint: the first few, then how many more. */
const some = (items: string[], max = 4) => items.length > max ? `${items.slice(0, max).join('; ')}; and ${items.length - max} more` : items.join('; ');

const UTILITIES = new Set(['electricity', 'water', 'internet', 'sewerage']);

/** A type is grouped by its income model; one whose owner is paid a fixed amount is in the MANAGE group. GRR is no
 *  longer a contract type (contractTypes.ts NO_GRR), so it has no group of its own. */
const MODEL_GROUP: Partial<Record<RevenueModel, ReportGroup>> = {
  management: 'PS', management_guarantee: 'PS', management_yearly_guarantee: 'PS', long_term: 'LT', master_lease: 'RTR',
};

/** Reads a master lease as a GRR contract: the company trades the unit and pays the owner a fixed rent. */
const asFixedRent = (u: UnitRow): UnitRow => ({
  ...u,
  revenue_model: u.revenue_model === 'master_lease' ? 'grr' : u.revenue_model,
  history: u.history?.map(h => (h.revenue_model === 'master_lease' ? { ...h, revenue_model: 'grr' } : h)),
});

/** Each owner's statement for the month on the report's Final column (owner statement close part 3, mockup screen 5):
 *  none yet, a draft, or final (by whom and when: the latest Make final in the history); what is still waiting before it
 *  can be made final (from October 2026); whether its payout is paid or being transferred (Unlock final follows that). */
export interface OwnerFinal {
  statementId: string | null; state: 'none' | 'draft' | 'final'; waiting: string | null;
  by: string | null; at: string | null; paid: boolean; transferring: boolean;
  /** Nothing in the month goes on the owner's statement (a master lease with no owner adjustment, or an owner still to be
   *  confirmed), so Generate makes none and there is nothing to make final (chew, 13 Nov 2026). */
  noStatement: boolean;
}

/** GET /api/portfolio/owner-report?month=2026-09 — the overall owner report (the owner workbook's overall report sheet): one row
 *  per unit with figures that month, worked out by the statement engine (ownerStatement.ts), so it agrees with the
 *  owner statements. Only the inputs are sent; every derived column comes from src/lib/ownerOverall.ts.
 *  Rows are grouped by the contract's income model (its staff code); a unit with no contract record is left out.
 *  A master lease (RTR) has no statement, so its row is the unit's trading worked out as a GRR unit's would be.
 *  Part 3: each row carries its owner, its contract's agent % (a share only) and the steps that list it and the ones locked;
 *  `owners` holds each owner's statement for the Final column, `may` whether this person may make or unlock final. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'This report is available to finance and management.', 403);

  const month = new URL(request.url).searchParams.get('month') || todayMyt().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422);

  const q: Query = (sql, ...args) => all(env, sql, ...args);
  const lockable = month >= LOCK_FROM;
  const [settings, loaded, types, late, statements, revenue] = await Promise.all([
    statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month)), contractTypes(env),
    // The company's share of late changes to an earlier, locked month that counts this month (part 2b, choice A).
    companyLateFor(env, null, month, month),
    all<{ id: string; owner_id: string; state: string }>(env, 'SELECT id, owner_id, state FROM owner_statements WHERE period_start = ?', `${month}-01`),
    // Revenue waits while the month's Airbnb reservations are still to confirm (Unit report locks, spec goal 4).
    lockable ? unconfirmedRevenue(env, month) : Promise.resolve({ byUnit: new Map<string, number>(), files: 0 }),
  ]);
  const inputs = await withYearToDate(q, loaded, month, settings);
  const dated = computeMonth(month, inputs, settings, 'dated');
  // From October 2026 the report shows O2 as the owner's statement takes it, the set the O2 lock keeps (builder check
  // answers, 13 Nov 2026): before final, the open owner adjustments up to the month's end that no other statement holds;
  // once final, the ones on that statement. Earlier months read adjustments by their dates, as before.
  const statementOf = new Map(statements.map(s => [s.owner_id, s]));
  const finalOf = new Map(statements.filter(s => s.state !== 'provisional').map(s => [s.owner_id, s.id]));
  const open = lockable
    ? computeMonth(month, { ...inputs, adjustments: inputs.adjustments.filter(a => !finalOf.has(a.owner_id) || a.statement_id === finalOf.get(a.owner_id)) },
      settings, 'open', ownerId => statementOf.get(ownerId)?.id ?? null)
    : dated;
  const months = lockable ? open : dated;
  // Each unit's categories and locks, and each owner's readiness for Make final (part 3), from the month worked out here.
  const step = lockable ? await monthSteps(env, month, { inputs, dated, open }) : null;
  const ready = step ? await finalReadiness(env, month, undefined, step) : new Map<string, FinalUnit[]>();
  const onStep = new Map<string, Set<Stage>>();
  if (step) for (const s of STAGES) for (const id of step.steps[s]) onStep.set(id, (onStep.get(id) ?? new Set()).add(s));
  // For the hints: check-outs in the month, and last month's owner adjustments (a repeat may be a mistake).
  const start = `${month}-01`, endEx = monthEndExclusive(month);
  const monthEnd = new Date(Date.parse(`${endEx}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const prev = previousMonth(month);
  const before = new Set(inputs.adjustments.filter(a => a.occurred_on.slice(0, 7) === prev).map(a => `${a.owner_id}|${a.unit_id ?? ''}|${Number(a.amount)}|${said(a.description)}`));
  const dayOf = (d: string) => `${Number(d.slice(8, 10))} ${monthLabel(d.slice(0, 7)).slice(0, 3)}`;
  /** What is in each lockable amount of a unit's month, in a sentence or two (the hover on the Unit report). */
  const hintsFor = (m: UnitMonth): Partial<Record<Stage, string>> => {
    const total = (cs: { amount: number }[]) => cs.reduce((n, c) => n + Number(c.amount), 0);
    const stays = m.lines.filter(l => l.type === 'gross' && l.category === 'hospitality').length;
    const checkouts = inputs.stays.filter(s => s.unit_id === m.unitId && s.check_out >= start && s.check_out < endEx).length;
    const toConfirm = revenue.byUnit.get(m.unitId) ?? 0;
    const cleans = m.stageCosts.cleaning, bills = m.stageCosts.utilities, other = m.stageCosts.additional;
    const o2 = m.lines.filter(l => l.type === 'adjustment' && (l.category === 'owner_credit' || l.category === 'owner_charge'));
    const same = (unitId: string, l: { amount: number; description: string }) => before.has(`${m.ownerId}|${unitId}|${l.amount}|${said(l.description)}`);
    const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' ');
    return {
      income: join(`${stays} ${stays === 1 ? 'reservation' : 'reservations'}, ${m.nights} ${m.nights === 1 ? 'night' : 'nights'}.`, notReadyText(toConfirm), m.warnings[0]),
      cleaning: join(cleans.length ? `${cleans.length} ${cleans.length === 1 ? 'clean' : 'cleans'}, ${rmText(total(cleans))}.` : 'No cleaning charged.',
        ...cleaningChecks({ checkouts, cleaning: total(cleans) }).map(c => `${c}.`)),
      utilities: join(bills.length ? `${some(bills.map(c => `${BILL[c.category] ?? 'Indah Water'} ${rmText(c.amount)}`))}.` : 'No bills yet. They can still be locked: a bill that comes late goes to the next month.',
        ...utilitiesChecks({ utilities: total(bills), contractEnd: m.terms.activeTo, monthEnd }).map(c => `${c}.`)),
      additional: other.length ? `${some(other.map(c => `${c.description || c.category} ${rmText(c.amount)}`))}.` : 'Nothing this month.',
      misc: m.miscCharge.amount ? `RM ${(settings.miscMonthly / 100).toFixed(2)} at ${(m.miscCharge.occupancy * 100).toFixed(2)}% occupancy.`
        : m.terms.miscCharges ? 'No nights this month, so no misc charge.' : 'No misc charge on this contract.',
      o2: join(o2.length ? `${some(o2.map(l => `${l.description} ${rmText(l.amount)} (${dayOf(l.occurredOn)})`))}.` : 'Nothing this month.',
        ...o2Checks({ held: step?.held.get(m.unitId) ?? 0, repeats: o2.filter(l => same(m.unitId, l) || same('', l)).length, prevMonth: monthLabel(prev).split(' ')[0] }).map(c => `${c}.`)),
    };
  };
  const unitOf = new Map(inputs.units.map(u => [u.id, u]));
  // Owner credits and charges stay where the statement puts them (O2 below), so the trading run takes none.
  const leased = inputs.units.filter(u => months.some(m => m.unitId === u.id && m.terms.model === 'master_lease'));
  const trading = new Map(leased.length
    ? computeMonth(month, { ...inputs, units: leased.map(asFixedRent), adjustments: [] }, settings, 'dated').map(t => [t.unitId, t])
    : []);

  const rows = months.flatMap(m => {
    const lease = m.terms.model === 'master_lease';
    const f = lease ? trading.get(m.unitId)! : m;
    const lateOf = late.get(`${m.unitId}|${month}`);
    if (!hasActivity(f) && !m.adjustmentIds.length && !lateOf) return [];
    const u = unitOf.get(m.unitId)!;
    const tenancy = isTenancy(m.terms.model);
    const share = f.terms.basis === 'share' && !tenancy;
    // The stored code belongs to the current contract; a month under an earlier one reads its code from that model.
    const stored = unitForMonth(u, month).contract_id === u.contract_id ? u.contract_code : null;
    const code = m.terms.source === 'contract' ? codeOf(types, m.terms.model, stored) : null;
    const group = code === null ? undefined : types.find(type => type.code === code)?.hasFixedOwnerAmount ? 'MANAGE' : MODEL_GROUP[m.terms.model];
    if (!group) return [];
    const sum = (pick: (category: string) => boolean) => f.deductionGroups.filter(g => pick(g.category)).reduce((n, g) => n + g.amount, 0);
    const locks = step?.locks.get(m.unitId) ?? {};
    return [{
      unitId: m.unitId, ownerId: m.ownerId, // The workbook's code (SKYLINE-C2701): the unit's own code field holds only its number (C27-01).
      code: unitCode(u.property_name, u.unit_number), building: u.property_name, ownerName: u.owner_name,
      group, contractCode: code,
      contract: share ? 'PS' : 'LT', revenue: f.gross,
      cleaning: sum(c => c.startsWith('cleaning')), utilities: sum(c => UTILITIES.has(c)),
      electricity: sum(c => c === 'electricity'), water: sum(c => c === 'water'), internet: sum(c => c === 'internet'), sewerage: sum(c => c === 'sewerage'),
      additional: sum(c => c === 'additional'), misc: sum(c => c === 'misc'),
      ownerPct: share ? f.terms.ownerPct ?? 0 : 0,
      // The agent's part of the operator's share (Agent = GP x agent %, part 3); a long-term let or fixed rent has none.
      agentPct: share ? Number(f.terms.agentPct ?? 0) : 0,
      // Unit report locks (13 Nov 2026): the categories that list the unit, who locked each and when, its Airbnb
      // reservations still to confirm (Revenue waits for them), and what is in each amount, shown when pointing at it.
      steps: STAGES.filter(s => onStep.get(m.unitId)?.has(s)),
      locks: Object.fromEntries(Object.entries(locks).map(([s, l]) => [s, { by: l!.locked_by_name, at: l!.locked_at }])),
      toConfirm: revenue.byUnit.get(m.unitId) ?? 0,
      hints: lockable ? hintsFor(m) : {},
      // A yearly guarantee is checked once a year (its true-up lands on the statement as a top-up), not month by month.
      // A long-term let's owner base is the owner's part of the rent; GRR and master lease, the fixed rent.
      ltGrr: tenancy ? f.ownerShare : !share ? f.fixedRent : f.terms.model === 'management_guarantee' ? f.guarantee : 0,
      // A tenancy is let by the month, not by the night, so it stays out of occupancy. The statement's nights leave out
      // owner stays and HostPlatform free stays (both owner_stay), so occupancy matches the misc charge (owner, 4 Nov 2026).
      o2: m.adjustmentsTotal, nights: f.nights, days: tenancy ? 0 : f.days,
      late: lateOf?.amount ?? 0, lateItems: lateOf?.items ?? [],
    }];
  });
  const ids = JSON.stringify(statements.map(s => s.id));
  const [finals, payouts] = statements.length ? await Promise.all([
    all<{ entity_id: string; actor_label: string; occurred_at: string }>(env, `SELECT DISTINCT ON (entity_id) entity_id, actor_label, occurred_at FROM audit_log
      WHERE entity_table = 'owner_statements' AND action = 'statement.finalise' AND entity_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      ORDER BY entity_id, occurred_at DESC`, ids),
    all<{ statement_id: string; state: string }>(env, `SELECT DISTINCT ON (statement_id) statement_id, state FROM payouts
      WHERE state <> 'cancelled' AND statement_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY statement_id, created_at DESC, id DESC`, ids),
  ]) : [[], []];
  // The owners Generate makes a statement for: as generate.ts does, a unit with something in the month, its owner known.
  const unknownOwner = new Set(inputs.units.filter(u => u.owner_name.toLowerCase() === PLACEHOLDER_OWNER.toLowerCase()).map(u => u.owner_id));
  const withStatement = new Set(months.filter(m => hasActivity(m) && !unknownOwner.has(m.ownerId)).map(m => m.ownerId));
  const owners: Record<string, OwnerFinal> = {};
  for (const ownerId of new Set(rows.map(r => r.ownerId))) {
    const st = statements.find(s => s.owner_id === ownerId);
    const units = ready.get(ownerId) ?? [];
    const open = lockable ? finalWaiting(units) : [];
    const final = !!st && st.state !== 'provisional';
    const by = st && final ? finals.find(x => x.entity_id === st.id) : undefined;
    const pay = st ? payouts.find(p => p.statement_id === st.id) : undefined;
    owners[ownerId] = {
      statementId: st?.id ?? null, state: !st ? 'none' : final ? 'final' : 'draft',
      waiting: open.length ? waitingText(open, units.length) : null,
      by: by?.actor_label ?? null, at: by?.occurred_at ?? null,
      paid: st?.state === 'paid' || pay?.state === 'paid', transferring: pay?.state === 'processing',
      noStatement: !st && !withStatement.has(ownerId),
    };
  }
  return json({
    generatedAt: nowIso(), month, rows, owners, lockFrom: LOCK_FROM,
    // Why the month cannot be locked (a month not yet ended, or before the locks start): the screen shows no locks then.
    lockProblem: lockMonthProblem(month, todayMyt()),
    // The Whole column row: per category how many of the units it lists are locked; and the month's Airbnb files.
    counts: step?.counts ?? null, airbnbFiles: revenue.files,
    may: { ...lockMay(session), makeFinal: can(session, 'makeFinal', 'edit'), unlockFinal: can(session, 'unlockFinal', 'edit'),
      // Make final generates the statement again first: POST /api/statements/generate is Finance edit work.
      generate: can(session, 'finance', 'edit') },
  });
};
