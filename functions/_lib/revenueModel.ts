import { checkDate } from './validate';

/** How an owner is paid for a unit: one revenue model per contract (migration 0093). The model decides how the
 *  monthly statement is worked out (ownerStatement.ts); the Units screen's Contract tab shows only its fields. */

export const REVENUE_MODELS = ['management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term', 'wh_long_term'] as const;
export type RevenueModel = typeof REVENUE_MODELS[number];
export const isRevenueModel = (v: unknown): v is RevenueModel => typeof v === 'string' && (REVENUE_MODELS as readonly string[]).includes(v);

export const MODEL_LABEL: Record<RevenueModel, string> = {
  management: 'Income split',
  management_guarantee: 'Split with minimum guarantee',
  management_yearly_guarantee: 'Split with yearly guarantee',
  grr: 'Guaranteed rent (GRR)',
  master_lease: 'Master lease',
  long_term: 'Long-term let',
  wh_long_term: 'Showroom / warehouse long-term',
};

/** The model of a contract row, or of a unit with no contract. A contract that has no revenue_model (written by the
 *  import or an older screen) reads exactly as the statement read it before the column existed: a GRR contract is
 *  guaranteed rent; a contract with a monthly minimum, or on Package D, is a share with a guarantee; anything else is
 *  a management share. A unit with no contract follows its own split (Unit资料): GRR, else a share. */
export function modelOf(r: {
  contract_id?: string | null; revenue_model?: string | null; model?: string | null; minimum_guarantee?: number | string | null;
  package?: string | null; split_kind?: string | null; split_value?: number | string | null;
}): RevenueModel {
  if (r.contract_id === null) return /grr|guaranteed rent/i.test(r.split_kind ?? '') && Number(r.split_value) > 0 ? 'grr' : 'management';
  if (isRevenueModel(r.revenue_model)) return r.revenue_model;
  if (r.model === 'grr') return 'grr';
  if (Number(r.minimum_guarantee ?? 0) > 0 || r.package === 'Package D') return 'management_guarantee';
  return 'management';
}

/** A short label for lists and chips: "Share 75/20/5", "Min. RM 2,800", "GRR RM 3,000". Money in sen. */
export function termsLabel(model: RevenueModel, t: { ownerPct: number | null; agentPct?: number | null; rent?: number; guarantee?: number }): string {
  const rm = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { maximumFractionDigits: 0 })}`;
  const pct = (n: number) => Number(n.toFixed(2));
  const split = () => {
    if (t.ownerPct == null) return '';
    const op = 100 - t.ownerPct, agent = t.agentPct ?? 0;
    return agent > 0 && agent < op ? `${pct(t.ownerPct)}/${pct(op - agent)}/${pct(agent)}` : `${pct(t.ownerPct)}/${pct(op)}`;
  };
  switch (model) {
    case 'management': return `Share ${split()}`.trim();
    case 'management_guarantee': return `Share ${split()}, min. ${rm(t.guarantee ?? 0)}`;
    case 'management_yearly_guarantee': return `Share ${split()}, min. ${rm(t.guarantee ?? 0)}/yr`;
    case 'grr': return `GRR ${rm(t.rent ?? 0)}/mo`;
    case 'master_lease': return `Master lease ${rm(t.rent ?? 0)}/mo`;
    case 'long_term': return `Long-term ${rm(t.rent ?? 0)}/mo`;
    case 'wh_long_term': return `WH long-term ${rm(t.rent ?? 0)}/mo`;
  }
}

export interface ContractDraft {
  revenueModel?: string; ownerPct?: number; managementPct?: number; agentPct?: number; agentName?: string | null;
  minimumGuarantee?: number; guaranteeStartsOn?: string | null; guaranteeEndsOn?: string | null;
  /** PS YGRR: the guarantee for each contract year, sen (owner_contracts.minimum_guarantee_annual). */
  yearlyGuarantee?: number;
  /** The staff's code (0125); its model must match revenueModel. */
  contractCode?: string;
  monthlyRent?: number; deposit?: number | null; tenantName?: string | null;
  startsOn?: string; endsOn?: string | null; renewsOn?: string | null; miscCharges?: boolean;
}

/** A profit share: the owner gets a percentage of the net (with or without a guarantee). */
export const isShare = (m: RevenueModel) => m === 'management' || m === 'management_guarantee' || m === 'management_yearly_guarantee';
/** Let to one tenant: the owner gets the tenant's rent less the operator %. A rental unit (long_term) or a showroom /
 *  warehouse (wh_long_term); the sums are the same. */
export const isTenancy = (m: RevenueModel) => m === 'long_term' || m === 'wh_long_term';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sen = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

/** Field-keyed problems with a contract for one model, empty when it can be saved. Only the chosen model's fields
 *  are checked; the others are ignored (and cleared on save). */
export function invalidDraft(d: ContractDraft): Record<string, string> {
  const f: Record<string, string> = {};
  if (!isRevenueModel(d.revenueModel)) { f.revenueModel = 'Pick one income model.'; return f; }
  const m = d.revenueModel;
  if (!d.startsOn || !DATE.test(d.startsOn)) f.startsOn = 'Enter the start date.';
  if (d.endsOn && (!DATE.test(d.endsOn) || (d.startsOn && d.endsOn < d.startsOn))) f.endsOn = 'The end date must be on or after the start date.';
  if (d.renewsOn && (!DATE.test(d.renewsOn) || (d.startsOn && d.renewsOn <= d.startsOn))) f.renewsOn = 'Renewal must be after the start date.';
  if (isShare(m)) {
    const o = Number(d.ownerPct), g = Number(d.managementPct), a = Number(d.agentPct ?? 0);
    for (const [k, v] of [['ownerPct', o], ['managementPct', g], ['agentPct', a]] as const) if (!Number.isFinite(v) || v < 0 || v > 100) f[k] = 'Enter 0 to 100.';
    if (!f.ownerPct && !f.managementPct && !f.agentPct && Math.abs(o + g + a - 100) > 0.001) f.ownerPct = `Owner, management and agent must add up to 100% (now ${Number((o + g + a).toFixed(2))}%).`;
    if (m === 'management_yearly_guarantee' && (!sen(d.yearlyGuarantee) || !d.yearlyGuarantee)) f.yearlyGuarantee = 'Enter the guarantee for each contract year.';
    if (m === 'management_guarantee') {
      if (!sen(d.minimumGuarantee) || !d.minimumGuarantee) f.minimumGuarantee = 'Enter the monthly minimum.';
      if (d.guaranteeStartsOn && !DATE.test(d.guaranteeStartsOn)) f.guaranteeStartsOn = 'Enter a date.';
      if (d.guaranteeEndsOn && (!DATE.test(d.guaranteeEndsOn) || (d.guaranteeStartsOn && d.guaranteeEndsOn < d.guaranteeStartsOn))) f.guaranteeEndsOn = 'The end must be on or after the start.';
    }
  } else {
    if (!sen(d.monthlyRent) || !d.monthlyRent) f.monthlyRent = 'Enter the monthly rent.';
    if (m === 'master_lease' && d.deposit != null && !sen(d.deposit)) f.deposit = 'Enter the deposit in ringgit.';
    if (isTenancy(m)) {
      if (!d.tenantName?.trim()) f.tenantName = 'Enter the tenant.';
      const g = Number(d.managementPct ?? 0);
      if (!Number.isFinite(g) || g < 0 || g > 100) f.managementPct = 'Enter 0 to 100.';
    }
  }
  // The pattern checks above let a non-existent day such as 31 February through.
  for (const k of ['startsOn', 'endsOn', 'renewsOn', 'guaranteeStartsOn', 'guaranteeEndsOn'] as const) if (!f[k]) checkDate(f, k, d[k]);
  return f;
}

/** The owner_contracts columns for a valid draft. Fields that do not belong to the model are cleared, so switching
 *  model never leaves an old guarantee or rent behind for the statement to pick up. */
export function draftColumns(d: ContractDraft) {
  const m = d.revenueModel as RevenueModel;
  const share = isShare(m);
  const operator = share ? 100 - Number(d.ownerPct) : isTenancy(m) ? Number(d.managementPct ?? 0) : 0;
  return {
    revenue_model: m,
    model: m === 'grr' ? 'grr' : 'management',
    management_fee_pct: Number(operator.toFixed(4)),
    agent_fee_pct: share && Number(d.agentPct ?? 0) > 0 ? Number(d.agentPct) : null,
    agent_name: share ? (d.agentName?.trim() || null) : null,
    minimum_guarantee: m === 'management_guarantee' ? Number(d.minimumGuarantee) : 0,
    // Only PS YGRR reads the yearly figure; on other models the imported one (informational) is left alone.
    ...(m === 'management_yearly_guarantee' ? { minimum_guarantee_annual: Number(d.yearlyGuarantee) } : {}),
    guarantee_starts_on: m === 'management_guarantee' ? (d.guaranteeStartsOn || null) : null,
    guarantee_ends_on: m === 'management_guarantee' ? (d.guaranteeEndsOn || null) : null,
    grr_amount: share ? 0 : Number(d.monthlyRent),
    deposit_amount: m === 'master_lease' ? (d.deposit ?? null) : null,
    tenant_name: isTenancy(m) ? (d.tenantName?.trim() || null) : null,
    starts_on: d.startsOn!, ends_on: d.endsOn || null, renews_on: d.renewsOn || null,
    misc_charges: share && d.miscCharges ? 1 : 0,
  };
}
