/** Owner statements, computed the way the owner workbook computes them (整体报告 / OWNER PAYOUT / 分成 / 水池).
 *  Owner ruling, Oct 2026: statements follow the workbook exactly. For one unit and one month:
 *
 *    Hospitality income   every stay split by night into the month (revenue.ts), on what the booking site paid out
 *                         (collected revenue, the workbook's 金额 Amount), or, where payments are recorded against the booking
 *                         (booking_payments), by each payment: a monthly instalment over the nights it covers (stayParts).
 *                         Occupancy = booked nights / days in month.
 *  - Expense deduction    cleaning (basic and deep, per session), electricity, water, Wi-Fi, Indah Water, additional
 *                         deductions (repairs and other owner-charged costs), and, when the unit's contract says so,
 *                         miscellaneous charges of RM 100 a month scaled by occupancy (RM 96.67 at 96.67%).
 *  = Net income
 *    then the contract:
 *    - share (profit share 75/20/5, or a management fee "15% To Operator"): the owner gets OWNER% of the net
 *      income; the rest is the operator's (management and agent). Package D: the owner gets at least the monthly
 *      minimum guarantee (prorated by the days it applies); what the company adds to reach it is a top-up.
 *    - fixed rent (GRR): the owner gets the monthly rent; the income and costs are the company's.
 *    - long-term let (revenue model long_term, no bookings): the income is the tenant's monthly rent, prorated by the
 *      tenancy days in the month; owner-paid costs come off it, and the management fee is a percentage of the rent.
 *    - master lease: the company rents the unit from the owner. There is no owner statement; the rent is a company
 *      cost (units/detail.ts shows it). Owner credits and charges on such a unit still reach the owner.
 *  Only expenses paid by the owner (expenses.charge_to = 'owner', "Paid by: Owner" on screen) are deducted; the
 *  company's, a tenant's or a guest's never reach the statement.
 *  = Payout before O2 adjustment
 *  + Owner adjustments (O2): credits and charges after the split, e.g. "MAINTENANCE FEE SEPT 26".
 *  = Net payout to owner
 *
 *  Rounding: as on the owner's printed report. Income and each deduction are rounded to the sen (income from the
 *  exact night split, miscellaneous charges from the exact occupancy); net income = income - deductions; the owner's
 *  share = net x OWNER%, rounded; the operator's share is the rest. Every line on the page can be checked by hand
 *  and the statement adds up to the sen. */
import { prorate, nightsInWindow, daysInMonth, monthEndExclusive } from './revenue';
import { modelOf, type RevenueModel } from './revenueModel';
import { DEDUCTION_TERMS, TERMS, toOperator } from '../../src/lib/statementTerms';

export type Query = <T = any>(sql: string, ...args: unknown[]) => Promise<T[]>;

/** Half away from zero, as the workbook (Google Sheets ROUND) shows money; immune to 2444.9255 being 2444.92549999. */
export const roundSen = (x: number) => Math.sign(x) * Math.round(Number(Math.abs(x).toFixed(6)));

export const DEDUCTIONS = DEDUCTION_TERMS;
export type DeductionCategory = typeof DEDUCTIONS[number][0];

export interface UnitRow {
  id: string; owner_id: string; owner_name: string; unit_number: string; unit_code: string | null; property_name: string; address: string | null;
  package: string | null; term: string | null; split_kind: string | null; split_value: number | null; unit_misc: number | null;
  contract_id: string | null; model: string | null; management_fee_pct: number | null; grr_amount: number | null;
  starts_on: string | null; ends_on: string | null; minimum_guarantee: number | null; guarantee_starts_on: string | null; guarantee_ends_on: string | null;
  contract_misc: number | null;
  /** 0093: the contract's revenue model (null = read from model / minimum guarantee / package), tenant, agent. */
  revenue_model?: string | null; tenant_name?: string | null; agent_fee_pct?: number | null;
  /** The unit's other contracts (history), newest start first: used for a month before the current contract began. */
  history?: ContractRow[];
}
export interface ContractRow {
  id: string; unit_id: string; revenue_model: string | null; model: string | null; management_fee_pct: number | null; grr_amount: number | null;
  starts_on: string | null; ends_on: string | null; minimum_guarantee: number | null; guarantee_starts_on: string | null; guarantee_ends_on: string | null;
  misc_charges: number | null; tenant_name: string | null; agent_fee_pct: number | null;
}
export interface StayRow {
  id: string; unit_id: string; check_in: string; check_out: string; collected_revenue: number; channel: string; external_ref: string | null; guest_name: string | null;
  /** The money the stay brought in, in pieces that each cover their own nights (stayParts). Absent: the whole stay
   *  at collected_revenue, as before booking_payments existed. */
  parts?: StayPart[];
}
export interface StayPart { check_in: string; check_out: string; amount: number }
export interface CostRow { id: string; unit_id: string; category: string; description: string; amount: number; incurred_on: string; reference: string | null; task_kind: string | null }
export interface AdjustmentRow { id: string; owner_id: string; unit_id: string | null; kind: string; amount: number; description: string; occurred_on: string; reference: string | null; state: string; statement_id: string | null }

export interface Terms {
  /** 'none': master lease, nothing to split (no statement unless there are owner credits or charges). */
  basis: 'share' | 'fixed_rent' | 'none'; source: 'contract' | 'unit' | 'default';
  model: RevenueModel; tenantName?: string | null; agentPct?: number | null;
  ownerPct: number | null; fixedRent: number; guarantee: number;
  activeFrom: string | null; activeTo: string | null; guaranteeFrom: string | null; guaranteeTo: string | null;
  miscCharges: boolean;
}

/** The split a unit is on. Its contract when it has one; else the unit's own split (Unit资料 rows with no contract
 *  start date have no contract record); else the organisation's default fee. */
export function termsFor(u: UnitRow, defaultFeePct: number): Terms {
  const miscCharges = Number(u.contract_misc ?? 0) === 1 || Number(u.unit_misc ?? 0) === 1;
  const base = { activeFrom: u.starts_on, activeTo: u.ends_on, guaranteeFrom: u.guarantee_starts_on, guaranteeTo: u.guarantee_ends_on, miscCharges };
  if (u.contract_id) {
    const model = modelOf(u);
    const agentPct = u.agent_fee_pct == null ? null : Number(u.agent_fee_pct);
    if (model === 'grr') return { ...base, model, basis: 'fixed_rent', source: 'contract', ownerPct: null, fixedRent: Number(u.grr_amount ?? 0), guarantee: 0 };
    if (model === 'master_lease') return { ...base, model, basis: 'none', source: 'contract', ownerPct: null, fixedRent: Number(u.grr_amount ?? 0), guarantee: 0, miscCharges: false };
    if (model === 'long_term') return { ...base, model, basis: 'share', source: 'contract', ownerPct: 100 - Number(u.management_fee_pct ?? 0), fixedRent: Number(u.grr_amount ?? 0), guarantee: 0, miscCharges: false, tenantName: u.tenant_name ?? null };
    // A management share never carries a guarantee; one with a guarantee is management_guarantee (modelOf reads a
    // contract with a minimum as that, so the figures are the ones the statement always gave).
    return { ...base, model, agentPct, basis: 'share', source: 'contract', ownerPct: 100 - Number(u.management_fee_pct ?? defaultFeePct), fixedRent: 0,
      guarantee: model === 'management_guarantee' ? Number(u.minimum_guarantee ?? 0) : 0 };
  }
  const none = { activeFrom: null, activeTo: null, guaranteeFrom: null, guaranteeTo: null, miscCharges };
  if (/grr|guaranteed rent/i.test(u.split_kind ?? '') && Number(u.split_value) > 0) return { ...none, model: 'grr', basis: 'fixed_rent', source: 'unit', ownerPct: null, fixedRent: Number(u.split_value), guarantee: 0 };
  if (/profit share/i.test(u.split_kind ?? '') && u.split_value !== null && Number(u.split_value) >= 0 && Number(u.split_value) <= 100) {
    return { ...none, model: 'management', basis: 'share', source: 'unit', ownerPct: Number(u.split_value), fixedRent: 0, guarantee: 0 };
  }
  return { ...none, model: 'management', basis: 'share', source: 'default', ownerPct: 100 - defaultFeePct, fixedRent: 0, guarantee: 0 };
}

/** The unit as it stood under the contract in force in `month`. The current contract applies unless it starts after
 *  the month and an earlier contract of the unit covers it (a unit's history, kept since 0093). */
export function unitForMonth(u: UnitRow, month: string): UnitRow {
  const start = `${month}-01`, endEx = monthEndExclusive(month);
  if (!u.history?.length || !u.starts_on || u.starts_on.slice(0, 10) < endEx) return u;
  const c = u.history.find(h => h.id !== u.contract_id && h.starts_on && h.starts_on.slice(0, 10) < endEx && (!h.ends_on || h.ends_on.slice(0, 10) >= start));
  if (!c) return u;
  return {
    ...u, contract_id: c.id, revenue_model: c.revenue_model, model: c.model, management_fee_pct: c.management_fee_pct, grr_amount: c.grr_amount,
    starts_on: c.starts_on, ends_on: c.ends_on, minimum_guarantee: c.minimum_guarantee, guarantee_starts_on: c.guarantee_starts_on,
    guarantee_ends_on: c.guarantee_ends_on, contract_misc: c.misc_charges, tenant_name: c.tenant_name, agent_fee_pct: c.agent_fee_pct,
  };
}

/** Days of the month inside [from, to] (inclusive dates; null = open). */
function daysCovered(month: string, from: string | null, to: string | null) {
  const start = `${month}-01`, endEx = monthEndExclusive(month);
  const a = from && from > start ? from : start;
  const toEx = to ? new Date(Date.parse(`${to.slice(0, 10)}T00:00:00Z`) + 864e5).toISOString().slice(0, 10) : endEx;
  return nightsInWindow(a, toEx < endEx ? toEx : endEx, start, endEx);
}

export function classifyCost(c: Pick<CostRow, 'category' | 'description' | 'task_kind'>): DeductionCategory {
  const cat = c.category, d = c.description ?? '';
  if (cat === 'cleaning' || cat === 'housekeeping') return c.task_kind === 'deep_clean' || /deep|move-out/i.test(d) ? 'cleaning_deep' : 'cleaning_basic';
  if (cat === 'electricity' || cat === 'water' || cat === 'internet') return cat;
  if (cat === 'sewerage' || (cat === 'utilities' && /indah|sewer|iwk/i.test(d))) return 'sewerage';
  return 'additional';
}

export interface Line {
  type: 'gross' | 'expense' | 'management_fee' | 'adjustment'; category: string | null; description: string; occurredOn: string;
  amount: number; quantity: number | null; unitId: string; reservationId?: string; expenseId?: string; adjustmentId?: string; reference?: string | null;
}
export interface DeductionGroup { category: DeductionCategory; label: string; uom: string; quantity: number; unitPrice: number | null; amount: number }
export interface UnitMonth {
  unitId: string; ownerId: string; month: string; terms: Terms;
  nights: number; days: number; occupancy: number;
  grossExact: number; gross: number; deductionGroups: DeductionGroup[]; deductions: number; deductionsExact: number; net: number;
  ownerPct: number | null; operatorShare: number; ownerShare: number; guarantee: number; topUp: number; fixedRent: number;
  payoutBeforeAdjustments: number; adjustmentsTotal: number; netPayout: number;
  lines: Line[]; adjustmentIds: string[];
  /** Things finance should look at before finalising (shown on the statement screen, never on the owner's report). */
  warnings: string[];
}

const ymd = (d: string) => d.slice(0, 10);

const partsOf = (s: StayRow): StayPart[] => s.parts ?? [{ check_in: s.check_in, check_out: s.check_out, amount: Number(s.collected_revenue) }];

export interface PaymentPiece { reservation_id: string; amount: number; status: string; kind: string; source: string; note: string | null }

/** What a stay brought in, as pieces each covering its own nights (owner, 10 Oct 2026: statements use the payments
 *  recorded against a booking, booking_payments, where there are any):
 *   - the owner workbook's payout lines (one per Airbnb monthly instalment), each over the dates the line covers
 *     ("Payout line for 2026-09-03 to 2026-10-03", written by the import), received or still expected, as the
 *     workbook counts them. They replace collected_revenue, which the import fills with the same money.
 *   - otherwise collected_revenue (HostPlatform's figure) over the whole stay.
 *   - plus money typed in here (a guest's payment, a site payout recorded by hand, less refunds), over the whole stay.
 *     A direct or Channex booking has no collected_revenue: before this its statement line was RM 0. */
export function stayParts(s: StayRow, pieces: PaymentPiece[]): StayPart[] | undefined {
  if (!pieces.length) return undefined;
  const whole = (amount: number): StayPart => ({ check_in: s.check_in, check_out: s.check_out, amount });
  const lines = pieces.filter(p => p.source === 'owner_workbook' && p.kind === 'ota_payout').map(p => {
    const m = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(p.note ?? '');
    const inside = m && m[1] < m[2] && m[1] >= s.check_in && m[2] <= s.check_out;
    return inside ? { check_in: m![1], check_out: m![2], amount: Number(p.amount) } : whole(Number(p.amount));
  });
  const typed = pieces.filter(p => p.source === 'manual' && p.status === 'received')
    .reduce((n, p) => n + (p.kind === 'refund' ? -Number(p.amount) : Number(p.amount)), 0);
  const parts = lines.length ? lines : [whole(Number(s.collected_revenue))];
  if (typed) parts.push(whole(typed));
  return parts;
}

/** One unit, one month. `stays`, `costs` and `adjustments` may hold other months and units: only what belongs here is used.
 *  adjustments: pass the ones to put on this statement (the caller decides: open ones for a new statement, dated ones for history). */
export function computeUnitMonth(month: string, unit: UnitRow, terms: Terms, stays: StayRow[], costs: CostRow[], adjustments: AdjustmentRow[], miscMonthly: number): UnitMonth {
  const start = `${month}-01`, endEx = monthEndExclusive(month), days = daysInMonth(month), end = new Date(Date.parse(`${endEx}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const lines: Line[] = [];

  // Income: each stay's nights in the month and that share of its payout. A long-term let or a master lease has no
  // stays that belong to the owner (the tenant's rent is the income; under a master lease all trading is the company's).
  const ownTrading = terms.model !== 'long_term' && terms.model !== 'master_lease';
  const mine = stays.filter(s => s.unit_id === unit.id && ownTrading).map(s => {
    const n = nightsInWindow(ymd(s.check_in), ymd(s.check_out), start, endEx);
    // Each payment piece is split by night over the nights it covers, so a long stay paid in monthly instalments is
    // credited to each month by its own instalment rather than by the stay's average night.
    const parts = partsOf(s);
    const exact = parts.reduce((sum, p) => sum + prorate(p.amount, nightsInWindow(p.check_in, p.check_out, start, endEx), nightsInWindow(p.check_in, p.check_out, p.check_in, p.check_out)), 0);
    return { s, n, exact, paid: parts.reduce((sum, p) => sum + p.amount, 0) };
  }).filter(x => x.n > 0).sort((a, b) => a.s.check_in.localeCompare(b.s.check_in));
  const nights = mine.reduce((n, x) => n + x.n, 0);
  // Long-term let: the month's rent, for the days of the month the tenancy covers.
  const tenancyDays = terms.model === 'long_term' ? daysCovered(month, terms.activeFrom, terms.activeTo) : 0;
  const rentExact = terms.model === 'long_term' ? (terms.fixedRent * tenancyDays) / days : 0;
  const grossExact = mine.reduce((n, x) => n + x.exact, 0) + rentExact;
  const gross = roundSen(grossExact);
  // Each stay's line is rounded so that the lines add up to the rounded total (largest remainder).
  const floors = mine.map(x => Math.floor(x.exact));
  let left = gross - floors.reduce((a, b) => a + b, 0);
  const order = mine.map((x, i) => [i, x.exact - floors[i]] as const).sort((a, b) => b[1] - a[1]);
  for (const [i] of order) { if (left <= 0) break; floors[i]++; left--; }
  if (left < 0) floors[floors.length - 1] += left;

  // Deductions, by the workbook's rows.
  // A master lease deducts nothing from the owner: every cost of the unit is the company's.
  const myCosts = terms.basis === 'none' ? [] : costs.filter(c => c.unit_id === unit.id && c.incurred_on >= start && c.incurred_on < endEx).sort((a, b) => a.incurred_on.localeCompare(b.incurred_on));
  const occupancy = nights / days;
  const miscExact = terms.miscCharges && terms.basis === 'share' ? miscMonthly * occupancy : 0;
  const misc = roundSen(miscExact);
  const groups = new Map<DeductionCategory, { quantity: number; amounts: number[] }>();
  for (const c of myCosts) {
    const cat = classifyCost(c);
    const g = groups.get(cat) ?? { quantity: 0, amounts: [] };
    g.quantity += 1; g.amounts.push(Number(c.amount)); groups.set(cat, g);
  }
  const deductionGroups: DeductionGroup[] = DEDUCTIONS.map(([category, label, uom]) => {
    if (category === 'misc') return { category, label, uom, quantity: misc ? 1 : 0, unitPrice: misc || null, amount: misc };
    const g = groups.get(category);
    const amount = g ? g.amounts.reduce((a, b) => a + b, 0) : 0;
    const perSession = uom === 'sessions';
    const uniform = g && g.amounts.every(a => a === g.amounts[0]);
    return {
      category, label, uom,
      quantity: g ? (perSession || category === 'additional' ? g.quantity : 1) : 0,
      unitPrice: !g ? null : perSession || category === 'additional' ? (uniform ? g.amounts[0] : null) : amount,
      amount,
    };
  });
  const costTotal = myCosts.reduce((n, c) => n + Number(c.amount), 0);
  const deductions = costTotal + misc, deductionsExact = costTotal + miscExact;
  const net = gross - deductions;

  // The split.
  let ownerShare = 0, operatorShare = 0, topUp = 0, guarantee = 0, fixedRent = 0, payoutBeforeAdjustments = 0;
  if (terms.basis === 'none') {
    // Master lease: nothing earned or owed by the owner through a statement.
  } else if (terms.model === 'long_term') {
    // The management fee is the operator's percentage of the rent; the owner gets the rest of the net.
    operatorShare = roundSen((gross * (100 - (terms.ownerPct ?? 100))) / 100);
    ownerShare = payoutBeforeAdjustments = net - operatorShare;
  } else if (terms.basis === 'fixed_rent') {
    // The workbook pays the whole month's rent whatever the contract dates say (rents run on past their end date
    // and a new one is paid in full from its first month), so the rent is not prorated.
    fixedRent = payoutBeforeAdjustments = roundSen(terms.fixedRent);
    operatorShare = net - fixedRent;
  } else {
    // The owner's share is taken from the net income as printed (2,647.45 x 85% = 2,250.33 on the sample report), so
    // the owner can check every figure on the page. The workbook's own sheet multiplies the unrounded net; the two can
    // differ by a sen (3 of 112 units in August 2026).
    const shareExact = (net * (terms.ownerPct ?? 0)) / 100;
    ownerShare = roundSen(shareExact);
    const gDays = terms.guarantee ? (terms.guaranteeFrom || terms.guaranteeTo ? daysCovered(month, terms.guaranteeFrom, terms.guaranteeTo) : days) : 0;
    const guaranteeExact = (terms.guarantee * gDays) / days;
    guarantee = roundSen(guaranteeExact);
    if (terms.guarantee > 0 && guaranteeExact > shareExact + 1e-9) {
      payoutBeforeAdjustments = guarantee; topUp = guarantee - ownerShare;
    } else {
      payoutBeforeAdjustments = ownerShare;
    }
    operatorShare = net - ownerShare;
  }

  // Lines, in the order the report shows them. A fixed-rent owner's statement carries the rent, not the unit's trading.
  if (terms.model === 'long_term') {
    if (gross) lines.push({ type: 'gross', category: 'long_term_rent', unitId: unit.id, quantity: tenancyDays, amount: gross, occurredOn: start,
      description: `${TERMS.monthlyRent}${terms.tenantName ? ` · ${terms.tenantName}` : ''}` });
    for (const c of myCosts) lines.push({
      type: 'expense', category: classifyCost(c), unitId: unit.id, expenseId: c.id, quantity: 1, amount: -Number(c.amount), occurredOn: c.incurred_on,
      description: c.description || c.category, reference: c.reference,
    });
    if (operatorShare) lines.push({ type: 'management_fee', category: 'operator_share', unitId: unit.id, quantity: null, amount: -operatorShare, occurredOn: end,
      description: toOperator(100 - (terms.ownerPct ?? 100)) });
  } else if (terms.basis === 'share') {
    mine.forEach((x, i) => lines.push({
      type: 'gross', category: 'hospitality', unitId: unit.id, reservationId: x.s.id, quantity: x.n, amount: floors[i], occurredOn: x.s.check_in > start ? ymd(x.s.check_in) : start,
      description: `${x.s.guest_name || 'Guest'} · ${ymd(x.s.check_in)} to ${ymd(x.s.check_out)}${x.n !== nightsInWindow(ymd(x.s.check_in), ymd(x.s.check_out), ymd(x.s.check_in), ymd(x.s.check_out)) ? ` (${x.n} ${x.n === 1 ? 'night' : 'nights'} in ${month})` : ''}`,
      reference: x.s.external_ref,
    }));
    for (const c of myCosts) lines.push({
      type: 'expense', category: classifyCost(c), unitId: unit.id, expenseId: c.id, quantity: 1, amount: -Number(c.amount), occurredOn: c.incurred_on,
      description: c.description || c.category, reference: c.reference,
    });
    if (misc) lines.push({ type: 'expense', category: 'misc', unitId: unit.id, quantity: occupancy, amount: -misc, occurredOn: end,
      description: 'Miscellaneous Charges' });
    if (operatorShare) lines.push({ type: 'management_fee', category: 'operator_share', unitId: unit.id, quantity: null, amount: -operatorShare, occurredOn: end,
      description: toOperator(100 - (terms.ownerPct ?? 0)) });
    if (topUp) lines.push({ type: 'adjustment', category: 'guarantee_top_up', unitId: unit.id, quantity: null, amount: topUp, occurredOn: end,
      description: TERMS.topUp });
  } else if (fixedRent) {
    lines.push({ type: 'adjustment', category: 'fixed_rent', unitId: unit.id, quantity: null, amount: fixedRent, occurredOn: end, description: TERMS.fixedRent });
  }
  const mineAdj = adjustments.filter(a => a.unit_id === unit.id);
  for (const a of mineAdj) lines.push({
    type: 'adjustment', category: Number(a.amount) >= 0 ? 'owner_credit' : 'owner_charge', unitId: unit.id, adjustmentId: a.id, quantity: null,
    amount: Number(a.amount), occurredOn: a.occurred_on, description: a.description.replace(/^O2:\s*/i, ''), reference: a.reference,
  });
  const adjustmentsTotal = mineAdj.reduce((n, a) => n + Number(a.amount), 0);
  const warnings: string[] = [];
  const unpaid = mine.filter(x => !(x.paid > 0));
  if (unpaid.length) warnings.push(`${unpaid.length} ${unpaid.length === 1 ? 'stay has' : 'stays have'} no payout recorded (${unpaid.reduce((n, x) => n + x.n, 0)} nights counted at RM 0): ${unpaid.map(x => `${x.s.check_in} to ${x.s.check_out}`).join(', ')}.`);
  if (terms.model === 'long_term' && !gross) warnings.push('Long-term let with no rent this month: check the tenancy dates on the contract.');
  if (terms.source === 'default') warnings.push(`No contract or split on this unit: the default ${fmtPct(100 - (terms.ownerPct ?? 0))} operator share was used.`);

  return {
    unitId: unit.id, ownerId: unit.owner_id, month, terms, nights, days, occupancy,
    grossExact, gross, deductionGroups, deductions, deductionsExact, net,
    ownerPct: terms.ownerPct, operatorShare, ownerShare, guarantee, topUp, fixedRent,
    payoutBeforeAdjustments, adjustmentsTotal, netPayout: payoutBeforeAdjustments + adjustmentsTotal,
    lines, adjustmentIds: mineAdj.map(a => a.id), warnings,
  };
}

export const fmtPct = (p: number) => `${Number(p.toFixed(2))}%`;

/** Does this unit belong on a statement this month: anything earned, charged, owed or guaranteed. */
export const hasActivity = (m: UnitMonth) => m.terms.basis === 'none'
  ? m.adjustmentIds.length > 0
  : m.nights > 0 || m.gross !== 0 || m.deductions !== 0 || m.adjustmentIds.length > 0 || m.fixedRent !== 0 || m.guarantee !== 0;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export interface Inputs { units: UnitRow[]; stays: StayRow[]; costs: CostRow[]; adjustments: AdjustmentRow[] }

export const UNIT_SQL = `
  SELECT u.id, u.owner_id, o.display_name AS owner_name, u.unit_number, u.unit_code, p.name AS property_name, u.address,
         u.package, u.term, u.split_kind, u.split_value, u.misc_charges AS unit_misc,
         c.id AS contract_id, c.model, c.management_fee_pct, c.grr_amount, c.starts_on, c.ends_on,
         c.minimum_guarantee, c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges AS contract_misc,
         c.revenue_model, c.tenant_name, c.agent_fee_pct
  FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
  LEFT JOIN owner_contracts c ON c.id = u.contract_id`;

/** Everything needed for [from, toExclusive), for every unit, some owners' units, or one unit. Six queries. */
export async function loadInputs(q: Query, from: string, toExclusive: string, scope: { ownerIds?: string[]; unitId?: string } = {}): Promise<Inputs> {
  const unitWhere = scope.unitId ? 'WHERE u.id = ?' : scope.ownerIds ? 'WHERE u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : '';
  const unitArg = scope.unitId ? [scope.unitId] : scope.ownerIds ? [JSON.stringify(scope.ownerIds)] : [];
  const units = await q<UnitRow>(`${UNIT_SQL} ${unitWhere} ORDER BY p.name, u.unit_number`, ...unitArg);
  const ids = JSON.stringify(units.map(u => u.id));
  const [stays, costs, adjustments, history] = await Promise.all([
    q<StayRow>(`
      SELECT r.id, r.unit_id, r.check_in, r.check_out, r.collected_revenue, r.channel, r.external_ref, g.full_name AS guest_name
      FROM reservations r LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.state IN ('confirmed','checked_in','checked_out') AND r.channel NOT IN ('maintenance_block','owner_stay')
        AND r.check_in < ? AND r.check_out > ? AND r.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, toExclusive, from, ids),
    q<CostRow>(`
      SELECT e.id, e.unit_id, e.category, e.description, e.amount, e.incurred_on, e.reference, t.kind AS task_kind
      FROM expenses e LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.charge_to = 'owner' AND e.incurred_on >= ? AND e.incurred_on < ? AND e.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, from, toExclusive, ids),
    q<AdjustmentRow>(`
      SELECT a.id, a.owner_id, a.unit_id, a.kind, a.amount, a.description, a.occurred_on, a.reference, a.state, a.statement_id
      FROM owner_adjustments a
      WHERE a.state <> 'held' AND a.occurred_on < ? AND a.owner_id IN (SELECT DISTINCT owner_id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)))
      ORDER BY a.occurred_on, a.id`, toExclusive, ids),
    q<ContractRow>(`
      SELECT c.id, c.unit_id, c.revenue_model, c.model, c.management_fee_pct, c.grr_amount, c.starts_on, c.ends_on, c.minimum_guarantee,
             c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges, c.tenant_name, c.agent_fee_pct
      FROM owner_contracts c WHERE c.unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      ORDER BY c.starts_on DESC, c.created_at DESC`, ids),
  ]);
  const historyOf = new Map<string, ContractRow[]>();
  for (const h of history) { const l = historyOf.get(h.unit_id); if (l) l.push(h); else historyOf.set(h.unit_id, [h]); }
  // The payments recorded against these stays (migration 0091); a database without the table reads as none.
  const pieces = stays.length ? await q<PaymentPiece>(`
    SELECT reservation_id, amount, status, kind, source, note FROM booking_payments
    WHERE reservation_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(stays.map(s => s.id))).catch(() => [] as PaymentPiece[]) : [];
  const piecesOf = new Map<string, PaymentPiece[]>();
  for (const p of pieces) { const l = piecesOf.get(p.reservation_id); if (l) l.push(p); else piecesOf.set(p.reservation_id, [p]); }
  return {
    units: units.map(u => (historyOf.get(u.id)?.length ? { ...u, history: historyOf.get(u.id) } : u)),
    stays: stays.map(s => {
      const row = { ...s, check_in: ymd(s.check_in), check_out: ymd(s.check_out), collected_revenue: Number(s.collected_revenue) };
      const parts = stayParts(row, piecesOf.get(s.id) ?? []);
      return parts ? { ...row, parts } : row;
    }),
    costs: costs.map(c => ({ ...c, incurred_on: ymd(c.incurred_on), amount: Number(c.amount) })),
    adjustments: adjustments.map(a => ({ ...a, amount: Number(a.amount) })),
  };
}

/** Which adjustments go on an owner's statement for `month`.
 *  'open': a statement being generated takes every open one dated up to the month's end that no other statement
 *  holds (a late one rolls into the next statement). 'dated': for history (the year-to-date page), the ones dated
 *  in the month, whatever happened to them since. An adjustment with no unit goes on the owner's first unit. */
export function adjustmentsFor(all: AdjustmentRow[], ownerId: string, month: string, mode: 'open' | 'dated', statementId: string | null, firstUnitId: string | null): AdjustmentRow[] {
  const start = `${month}-01`, endEx = monthEndExclusive(month);
  return all.filter(a => a.owner_id === ownerId && a.occurred_on < endEx && (mode === 'dated'
    ? a.occurred_on >= start
    : a.state === 'open' && (a.statement_id === null || a.statement_id === statementId)))
    .map(a => (a.unit_id ? a : { ...a, unit_id: firstUnitId }));
}

/** Settings the computation reads, with their defaults. */
export async function statementSettings(q: Query): Promise<{ defaultFeePct: number; miscMonthly: number }> {
  const rows = await q<{ key: string; value: string }>(`SELECT key, value FROM settings WHERE key IN ('locale.managementFeePct','finance.default_fee_pct','report.miscChargeMonthly')`);
  const m = new Map(rows.map(r => [r.key, r.value]));
  const fee = Number(m.get('locale.managementFeePct') ?? m.get('finance.default_fee_pct') ?? 25);
  const misc = Number(m.get('report.miscChargeMonthly') ?? 10000);
  return { defaultFeePct: Number.isFinite(fee) ? fee : 25, miscMonthly: Number.isFinite(misc) ? misc : 10000 };
}

/** Every unit's month for one owner set, as the statements screen and the year-to-date page need it. */
export function computeMonth(month: string, inputs: Inputs, settings: { defaultFeePct: number; miscMonthly: number }, mode: 'open' | 'dated', statementIdOf: (ownerId: string) => string | null = () => null): UnitMonth[] {
  const byOwner = new Map<string, UnitRow[]>();
  for (const u of inputs.units) { const l = byOwner.get(u.owner_id); if (l) l.push(u); else byOwner.set(u.owner_id, [u]); }
  const start = `${month}-01`, endEx = monthEndExclusive(month);
  const stays = inputs.stays.filter(s => s.check_in < endEx && s.check_out > start);
  const costs = inputs.costs.filter(c => c.incurred_on >= start && c.incurred_on < endEx);
  const out: UnitMonth[] = [];
  for (const [ownerId, units] of byOwner) {
    const asOf = units.map(u => unitForMonth(u, month));
    // An owner credit or charge with no unit goes on the owner's first unit that has a statement (not a master lease).
    const first = asOf.find(u => modelOf(u) !== 'master_lease') ?? asOf[0];
    const adj = adjustmentsFor(inputs.adjustments, ownerId, month, mode, statementIdOf(ownerId), first?.id ?? null);
    for (const u of asOf) out.push(computeUnitMonth(month, u, termsFor(u, settings.defaultFeePct), stays, costs, adj, settings.miscMonthly));
  }
  return out;
}
