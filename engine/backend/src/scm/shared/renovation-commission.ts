// Conts only (not part of Houzs's code): sales commission on renovation contracts (owner, 25 Nov 2026).
//
// Pure math, no I/O. Money in sen, rates in basis points (100 bp = 1%).
//
// The rule, as the owner set it:
//   - Each brand has its own scheme: a sales manager with a manager rate (e.g. 4%), the salesperson's rate by tier of
//     their sales in the month (RM 60,000 0.5%, RM 100,000 1% ... RM 300,000 3%), an optional company pool kept aside,
//     and the stages the commission is paid out at.
//   - The salesperson earns their tier rate; the manager earns the manager rate less it (manager 4%, salesperson 1%:
//     manager 3%). A manager who opened the order earns the whole manager rate.
//   - A month's sales are the sales orders dated in it plus the VOs dated in it: an order of RM 100,000 last month that
//     a VO took to RM 110,000 this month counts RM 10,000 this month. So one order can be paid at several rates, one per
//     month it grew in, each at that month's tier.
//   - Commission is released in stages as the customer pays (half at the 2nd payment, half at the last, or as set).
// The base is the contract as it stands; collected money is what finance has confirmed.

export type StageKind = 'collected' | 'instalment';

export interface CommissionStage {
  label: string;
  /** collected: `value` is the share of the contract collected, in bp. instalment: `value` is the payment number that
      must be paid in full (the contract's own instalment plan decides how much that is). */
  kind: StageKind;
  value: number;
  /** Share of the commission released when the stage is reached, in bp. */
  releaseBp: number;
}

/** A salesperson's rate once their sales in the month reach `fromSen`. */
export interface CommissionTier { fromSen: number; bp: number }

export interface CommissionScheme {
  id: string;
  name: string;
  /** The brand on the sales order this scheme pays (null: every brand without a scheme of its own). */
  branding: string | null;
  managerStaffId: string | null;
  managerBp: number;
  companyPoolBp: number;
  tiers: CommissionTier[];
  stages: CommissionStage[];
}

/** A slice of a contract's value dated in one month: the order itself, a VO, or what is left (credit notes). */
export interface ContractPortion { month: string; date: string; sen: number; source: 'SO' | 'VO' | 'OTHER'; ref: string }

export interface ContractMoney {
  baseSen: number;
  collectedSen: number;
  /** The contract's instalments with their cumulative share, in bp (25%, 50%, ...). Empty for an order with no plan. */
  instalments: Array<{ seq: number; cumBp: number }>;
}

export interface PortionCommission extends ContractPortion {
  monthSalesSen: number; salesBp: number; managerBp: number; salesSen: number; managerSen: number;
  salespersonId: string; managerStaffId: string | null;
  /** When the rates were fixed (the month closed); null while the month is still open and the rates can move. */
  lockedAt: string | null;
}

/** The rates fixed for one part of a contract once its month closed (scm.reno_commission_locks). */
export interface PortionLock {
  salespersonId: string | null; managerStaffId: string | null; monthSalesSen: number; salesBp: number; managerBp: number; lockedAt: string;
}

/** The key a part of a contract is locked under: 'SO', the VO number, or 'OTHER'. */
export const portionKey = (p: Pick<ContractPortion, 'source' | 'ref'>): string => (p.source === 'VO' ? p.ref : p.source);

export interface CommissionShare {
  staffId: string;
  role: 'sales' | 'manager';
  /** The rate over the whole contract (one order can be paid at several rates); display only. */
  rateBp: number;
  totalSen: number;
  earnedSen: number;
  paidSen: number;
  claimableSen: number;
}

export interface StageState { label: string; thresholdBp: number | null; reached: boolean; releaseBp: number }

export interface ContractCommission {
  collectedBp: number;
  releasedBp: number;
  stages: StageState[];
  portions: PortionCommission[];
  shares: CommissionShare[];
  companyPoolSen: number;
}

const applyBp = (sen: number, bp: number): number => Math.round((sen * bp) / 10_000);
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** Splits a contract into the months it was sold in: the order on its date, each approved VO on its date, and whatever
    else moved the contract (credit notes, rounding) on the order's date, so the portions always add up to the base. */
export function contractPortions(soDocNo: string, soDate: string, baseSen: number, originalSen: number, vos: ReadonlyArray<{ voNo: string; date: string; netSen: number }>): ContractPortion[] {
  const out: ContractPortion[] = [{ month: monthOf(soDate), date: soDate, sen: originalSen, source: 'SO', ref: soDocNo }];
  for (const v of [...vos].sort((a, b) => a.date.localeCompare(b.date) || a.voNo.localeCompare(b.voNo))) {
    if (v.netSen !== 0) out.push({ month: monthOf(v.date), date: v.date, sen: v.netSen, source: 'VO', ref: v.voNo });
  }
  const rest = baseSen - out.reduce((t, p) => t + p.sen, 0);
  if (rest !== 0) out.push({ month: monthOf(soDate), date: soDate, sen: rest, source: 'OTHER', ref: 'Credit notes and other changes' });
  return out;
}

/** The salesperson's rate for a month's sales: the highest tier reached, never above the manager rate. */
export function salesRateBp(tiers: readonly CommissionTier[], monthSalesSen: number, capBp: number): number {
  let bp = 0;
  for (const t of [...tiers].sort((a, b) => a.fromSen - b.fromSen)) if (monthSalesSen >= t.fromSen) bp = t.bp;
  return Math.max(0, Math.min(bp, capBp));
}

/** Each salesperson's sales per month, over every contract they opened: key `${staffId}|${month}`. */
export function monthlySales(contracts: ReadonlyArray<{ salespersonId: string | null; portions: readonly ContractPortion[] }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of contracts) {
    if (!c.salespersonId) continue;
    for (const p of c.portions) out.set(`${c.salespersonId}|${p.month}`, (out.get(`${c.salespersonId}|${p.month}`) ?? 0) + p.sen);
  }
  return out;
}

/** The share of the contract a stage needs collected, or null when the contract has no such payment. */
export function stageThresholdBp(stage: CommissionStage, instalments: ContractMoney['instalments']): number | null {
  if (stage.kind === 'collected') return Math.max(0, Math.min(10_000, stage.value));
  const inst = instalments.find((i) => i.seq === stage.value);
  return inst ? inst.cumBp : null;
}

/** Commission on one contract, split between the salesperson and the manager. `sales` is monthlySales over the same
    scheme; `paid` is what has already been paid to each person on this contract. */
export function contractCommission(
  money: ContractMoney,
  portions: readonly ContractPortion[],
  scheme: CommissionScheme,
  salespersonId: string,
  sales: ReadonlyMap<string, number>,
  paid: ReadonlyMap<string, number>,
  locks?: ReadonlyMap<string, PortionLock>,
): ContractCommission {
  const base = Math.max(0, money.baseSen);
  const collectedBp = base > 0 ? Math.min(10_000, Math.floor((Math.max(0, money.collectedSen) * 10_000) / base)) : 0;
  const stages: StageState[] = scheme.stages.map((s) => {
    const thresholdBp = stageThresholdBp(s, money.instalments);
    return { label: s.label, thresholdBp, reached: thresholdBp != null && base > 0 && money.collectedSen * 10_000 >= thresholdBp * base, releaseBp: s.releaseBp };
  });
  const releasedBp = Math.min(10_000, stages.filter((s) => s.reached).reduce((t, s) => t + s.releaseBp, 0));

  const isManager = scheme.managerStaffId != null && scheme.managerStaffId === salespersonId;
  const rows: PortionCommission[] = portions.map((p) => {
    const lock = locks?.get(portionKey(p));
    if (lock) {
      const sp = lock.salespersonId ?? salespersonId;
      return { ...p, monthSalesSen: lock.monthSalesSen, salesBp: lock.salesBp, managerBp: lock.managerBp, salespersonId: sp, managerStaffId: lock.managerStaffId,
        salesSen: applyBp(p.sen, lock.salesBp), managerSen: applyBp(p.sen, lock.managerBp), lockedAt: lock.lockedAt };
    }
    const monthSalesSen = sales.get(`${salespersonId}|${p.month}`) ?? 0;
    const salesBp = isManager ? scheme.managerBp : salesRateBp(scheme.tiers, monthSalesSen, scheme.managerBp);
    const managerBp = isManager || !scheme.managerStaffId ? 0 : scheme.managerBp - salesBp;
    return { ...p, monthSalesSen, salesBp, managerBp, salespersonId, managerStaffId: isManager ? null : scheme.managerStaffId,
      salesSen: applyBp(p.sen, salesBp), managerSen: applyBp(p.sen, managerBp), lockedAt: null };
  });
  /* One share per person over every part: a manager who opened the order, or who managed some months, is paid as one. */
  const totals = new Map<string, { sales: number; manager: number }>();
  const add = (id: string | null, key: 'sales' | 'manager', sen: number) => {
    if (!id) return;
    const t = totals.get(id) ?? { sales: 0, manager: 0 };
    t[key] += sen;
    totals.set(id, t);
  };
  for (const r of rows) {
    const ownOrder = r.managerStaffId == null && r.salespersonId === scheme.managerStaffId;
    add(r.salespersonId, ownOrder ? 'manager' : 'sales', r.salesSen);
    add(r.managerStaffId, 'manager', r.managerSen);
  }
  for (const id of paid.keys()) if (!totals.has(id)) totals.set(id, { sales: 0, manager: 0 });
  const shares: CommissionShare[] = [...totals].map(([staffId, t]) => {
    const totalSen = t.sales + t.manager;
    const earnedSen = applyBp(totalSen, releasedBp);
    const paidSen = paid.get(staffId) ?? 0;
    return { staffId, role: t.sales !== 0 || t.manager === 0 ? 'sales' as const : 'manager' as const, rateBp: base > 0 ? Math.round((totalSen * 10_000) / base) : 0,
      totalSen, earnedSen, paidSen, claimableSen: Math.max(0, earnedSen - paidSen) };
  }).filter((x) => x.totalSen !== 0 || x.paidSen !== 0)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'sales' ? -1 : 1));
  return { collectedBp, releasedBp, stages, portions: rows, shares, companyPoolSen: applyBp(base, scheme.companyPoolBp) };
}

/** Checks a scheme as entered on the settings screen; returns the problems in plain words (empty when it is fine). */
export function schemeProblems(t: Pick<CommissionScheme, 'name' | 'managerBp' | 'companyPoolBp' | 'tiers' | 'stages'>): string[] {
  const out: string[] = [];
  if (!t.name.trim()) out.push('Give the scheme a name.');
  if (!(t.managerBp >= 0 && t.managerBp <= 10_000)) out.push('Manager rate must be between 0% and 100%.');
  if (!(t.companyPoolBp >= 0 && t.companyPoolBp <= 10_000)) out.push('Company pool must be between 0% and 100%.');
  if (t.tiers.length === 0) out.push('Add at least one salesperson tier.');
  t.tiers.forEach((x, i) => {
    if (!(x.fromSen >= 0)) out.push(`Tier ${i + 1}: enter the monthly sales it starts from.`);
    if (x.bp > t.managerBp) out.push(`Tier ${i + 1}: the salesperson rate cannot be more than the manager rate.`);
  });
  if (new Set(t.tiers.map((x) => x.fromSen)).size !== t.tiers.length) out.push('Two tiers start from the same monthly sales.');
  if (t.stages.length === 0) out.push('Add at least one payout stage.');
  const released = t.stages.reduce((s, x) => s + x.releaseBp, 0);
  if (t.stages.length > 0 && released !== 10_000) out.push(`The payout stages add up to ${(released / 100).toFixed(2)}%; they must add up to 100%.`);
  t.stages.forEach((s, i) => {
    if (!s.label.trim()) out.push(`Stage ${i + 1} needs a name.`);
    if (s.kind === 'instalment' && !(Number.isInteger(s.value) && s.value >= 1)) out.push(`Stage ${i + 1}: enter which payment (1, 2, 3 ...).`);
    if (s.kind === 'collected' && !(s.value > 0 && s.value <= 10_000)) out.push(`Stage ${i + 1}: collected share must be between 0% and 100%.`);
  });
  return out;
}
