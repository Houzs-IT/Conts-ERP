import { type Env, all, json, fail, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { todayMyt } from '../../_lib/ops';
import { loadInputs, withYearToDate, computeMonth, statementSettings, hasActivity, unitForMonth, type Query, type UnitRow } from '../../_lib/ownerStatement';
import { unitCode } from '../../_lib/ownerReport';
import { isTenancy, type RevenueModel } from '../../_lib/revenueModel';
import { codeOf } from '../../_lib/unitPurpose';
import { contractTypes } from '../../_lib/contractTypes';
import { monthEndExclusive } from '../../_lib/revenue';
import { companyLateFor, finalReadiness } from '../../_lib/ownerLocks';
import { can } from '../../_lib/access';
import { LOCK_FROM, finalWaiting, waitingText, type FinalUnit } from '../../_lib/stageLocks';
import type { ReportGroup } from '../../../src/lib/ownerOverall';

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
  const [settings, loaded, types, late, ready, statements] = await Promise.all([
    statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month)), contractTypes(env),
    // The company's share of late changes to an earlier, locked month that counts this month (part 2b, choice A).
    companyLateFor(env, null, month, month),
    // Each owner's units on the month's steps and their locks (part 3): Make final waits for them all.
    lockable ? finalReadiness(env, month) : Promise.resolve(new Map<string, FinalUnit[]>()),
    all<{ id: string; owner_id: string; state: string }>(env, 'SELECT id, owner_id, state FROM owner_statements WHERE period_start = ?', `${month}-01`),
  ]);
  const inputs = await withYearToDate(q, loaded, month, settings);
  const months = computeMonth(month, inputs, settings, 'dated');
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
    const close = ready.get(m.ownerId)?.find(x => x.unitId === m.unitId);
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
      steps: close?.steps ?? [], locked: close?.locked ?? [],
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
    };
  }
  return json({
    generatedAt: nowIso(), month, rows, owners, lockFrom: LOCK_FROM,
    may: { makeFinal: can(session, 'makeFinal', 'edit'), unlockFinal: can(session, 'unlockFinal', 'edit') },
  });
};
