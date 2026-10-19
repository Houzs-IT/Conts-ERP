/** A unit's contract as the Contract tab edits it (one revenue model, only that model's fields), its history, and
 *  the "how this month's statement works" example worked out by the statement engine on real figures. */
import { loadInputs, withYearToDate, computeMonth, statementSettings, termsFor, unitForMonth, type Query, type UnitRow, type UnitMonth } from './ownerStatement';
import { modelOf, termsLabel, draftColumns, isShare, type RevenueModel, type ContractDraft } from './revenueModel';
import { monthEndExclusive } from './revenue';
import { shiftMonth } from './expenses';
import { codeOf, type ContractCode } from './unitPurpose';

export interface ContractView {
  id: string | null; revenueModel: RevenueModel; termsLabel: string;
  ownerPct: number | null; managementPct: number | null; agentPct: number | null; agentName: string | null;
  minimumGuarantee: number; guaranteeStartsOn: string | null; guaranteeEndsOn: string | null;
  /** PS YGRR: the guarantee for each contract year, sen. */
  yearlyGuarantee: number;
  /** The staff's short code (WH, PS, PS GRR, ...). */
  contractCode: ContractCode;
  /** The agreement or memo file a renewal was saved with. */
  agreementDocumentId: string | null;
  monthlyRent: number; deposit: number | null; tenantName: string | null;
  startsOn: string | null; endsOn: string | null; renewsOn: string | null; miscCharges: boolean;
  /** Other units on the same contract record (older agreements covered every unit of an owner). */
  sharedWith: number; createdAt: string | null;
}

/** A contract row (or, with no contract, the unit's own split) as the screen shows it. */
export function contractView(c: any | null, unit: { split_kind?: string | null; split_value?: number | null; package?: string | null; misc_charges?: number | null }, defaultFeePct: number, sharedWith = 0): ContractView {
  if (!c) {
    const model = modelOf({ contract_id: null, split_kind: unit.split_kind, split_value: unit.split_value });
    const ownerPct = model === 'management' ? (/profit share/i.test(unit.split_kind ?? '') && unit.split_value != null ? Number(unit.split_value) : 100 - defaultFeePct) : null;
    const rent = model === 'grr' ? Number(unit.split_value ?? 0) : 0;
    return {
      id: null, revenueModel: model, termsLabel: termsLabel(model, { ownerPct, rent }), ownerPct, managementPct: ownerPct == null ? null : 100 - ownerPct, agentPct: null, agentName: null,
      minimumGuarantee: 0, guaranteeStartsOn: null, guaranteeEndsOn: null, yearlyGuarantee: 0, contractCode: codeOf(model), agreementDocumentId: null, monthlyRent: rent, deposit: null, tenantName: null,
      startsOn: null, endsOn: null, renewsOn: null, miscCharges: Number(unit.misc_charges ?? 0) === 1, sharedWith: 0, createdAt: null,
    };
  }
  const model = modelOf({ ...c, package: unit.package });
  const fee = Number(c.management_fee_pct ?? defaultFeePct), agent = c.agent_fee_pct == null ? null : Number(c.agent_fee_pct);
  const share = isShare(model);
  const ownerPct = share ? 100 - fee : null;
  const code = codeOf(model, c.contract_code);
  return {
    id: c.id, revenueModel: model,
    // A WH lease is worked out as a master lease but is named as the staff name it.
    termsLabel: code === 'WH' ? `Lease RM ${(Number(c.grr_amount ?? 0) / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}/mo` : termsLabel(model, { ownerPct, agentPct: agent, rent: Number(c.grr_amount ?? 0), guarantee: Number(model === 'management_yearly_guarantee' ? c.minimum_guarantee_annual ?? 0 : c.minimum_guarantee ?? 0) }),
    ownerPct, managementPct: share ? fee - (agent ?? 0) : model === 'long_term' ? fee : null, agentPct: share ? agent : null, agentName: c.agent_name ?? null,
    minimumGuarantee: model === 'management_guarantee' ? Number(c.minimum_guarantee ?? 0) : 0,
    yearlyGuarantee: model === 'management_yearly_guarantee' ? Number(c.minimum_guarantee_annual ?? 0) : 0,
    contractCode: codeOf(model, c.contract_code), agreementDocumentId: c.agreement_document_id ?? null,
    guaranteeStartsOn: c.guarantee_starts_on ?? null, guaranteeEndsOn: c.guarantee_ends_on ?? null,
    monthlyRent: share ? 0 : Number(c.grr_amount ?? 0), deposit: c.deposit_amount == null ? null : Number(c.deposit_amount), tenantName: c.tenant_name ?? null,
    startsOn: c.starts_on ?? null, endsOn: c.ends_on ?? null, renewsOn: c.renews_on ?? null, miscCharges: Number(c.misc_charges ?? 0) === 1,
    sharedWith, createdAt: c.created_at ?? null,
  };
}

export interface Example {
  month: string; model: RevenueModel; nights: number; occupancy: number;
  income: number; costs: { label: string; amount: number }[]; costsTotal: number; net: number;
  ownerPct: number | null; ownerShare: number; operatorShare: number; managementShare: number; agentShare: number;
  guarantee: number; topUp: number; rent: number; payout: number; adjustments: number; netPayout: number;
  /** PS YGRR: the contract year this month is in, and on its last month the year's shares against the guarantee. */
  yearly: UnitMonth['yearly'] | null;
  /** The company's side: what the unit traded (income and every cost, whoever paid) for GRR and master lease. */
  company: { income: number; costs: number; rentToOwner: number; result: number } | null;
  /** Costs on the unit paid by someone other than the owner: never on the statement. */
  otherPayers: number;
}

/** Last month (or `month`) for one unit, by the statement engine. `draft` replaces the unit's contract terms, so the
 *  screen shows what the statement would be under terms not yet saved. */
export async function unitExample(q: Query, unitId: string, month: string, draft?: ContractDraft): Promise<Example | null> {
  const [settings, inputs] = await Promise.all([statementSettings(q), loadInputs(q, `${month}-01`, monthEndExclusive(month), { unitId })]);
  const base = inputs.units.find(u => u.id === unitId);
  if (!base) return null;
  let unit: UnitRow = base;
  if (draft) {
    const c = draftColumns(draft);
    unit = {
      ...base, history: undefined, contract_id: base.contract_id ?? 'draft', revenue_model: c.revenue_model, model: c.model, management_fee_pct: c.management_fee_pct,
      agent_fee_pct: c.agent_fee_pct, grr_amount: c.grr_amount, minimum_guarantee: c.minimum_guarantee, guarantee_starts_on: c.guarantee_starts_on,
      guarantee_ends_on: c.guarantee_ends_on, starts_on: c.starts_on, ends_on: c.ends_on, tenant_name: c.tenant_name, contract_misc: c.misc_charges,
      minimum_guarantee_annual: c.minimum_guarantee_annual ?? base.minimum_guarantee_annual ?? null,
    };
  }
  // Owner credits and charges dated in the month, as the year-to-date page shows them.
  const m = computeMonth(month, await withYearToDate(q, { ...inputs, units: [unit] }, month, settings), settings, 'dated').find(x => x.unitId === unitId) as UnitMonth;
  // The contract in force that month (an earlier one when the current contract starts later).
  const terms = termsFor(unitForMonth(unit, month), settings.defaultFeePct);
  const others = await q<{ total: number; all_costs: number }>(`
    SELECT COALESCE(SUM(amount) FILTER (WHERE charge_to <> 'owner'), 0) AS total, COALESCE(SUM(amount), 0) AS all_costs
    FROM expenses WHERE unit_id = ? AND incurred_on >= ? AND incurred_on < ?`, unitId, `${month}-01`, monthEndExclusive(month));
  const otherPayers = Number(others[0]?.total ?? 0), allCosts = Number(others[0]?.all_costs ?? 0);

  let company: Example['company'] = null;
  if (terms.model === 'grr' || terms.model === 'master_lease') {
    // What the unit traded: the same night split of the stays, on a share basis with nothing to the owner.
    const trading = computeMonth(month, { ...inputs, units: [{ ...unit, contract_id: 'trading', revenue_model: 'management', model: 'management', management_fee_pct: 100, minimum_guarantee: 0, contract_misc: 0, unit_misc: 0, history: undefined }] }, settings, 'dated')[0];
    const rent = Math.round(terms.fixedRent);
    company = { income: trading.gross, costs: allCosts, rentToOwner: rent, result: trading.gross - allCosts - rent };
  }
  const agentPct = terms.agentPct ?? 0;
  const agentShare = m.ownerPct != null && agentPct > 0 && terms.model !== 'long_term' ? Math.round((m.net * agentPct) / 100) : 0;
  return {
    month, model: terms.model, nights: m.nights, occupancy: m.occupancy,
    income: m.gross, costs: m.deductionGroups.filter(g => g.amount).map(g => ({ label: g.label, amount: g.amount })), costsTotal: m.deductions, net: m.net,
    ownerPct: m.ownerPct, ownerShare: m.ownerShare, operatorShare: m.operatorShare, managementShare: m.operatorShare - agentShare, agentShare,
    guarantee: m.guarantee, topUp: m.topUp, rent: terms.model === 'master_lease' ? 0 : m.fixedRent, payout: m.payoutBeforeAdjustments,
    adjustments: m.adjustmentsTotal, netPayout: m.netPayout, company, otherPayers, yearly: m.yearly ?? null,
  };
}

export const lastMonth = (today: string) => shiftMonth(today.slice(0, 7), -1);
