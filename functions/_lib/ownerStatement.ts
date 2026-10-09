/** Owner statements, computed the way the owner workbook computes them (整体报告 / OWNER PAYOUT / 分成 / 水池).
 *  Owner ruling, Oct 2026: statements follow the workbook exactly. For one unit and one month:
 *
 *    Hospitality income   every stay split by night into the month (revenue.ts), on what the booking site paid out
 *                         (collected revenue, the workbook's 金额 Amount). Occupancy = booked nights / days in month.
 *  - Expense deduction    cleaning (basic and deep, per session), electricity, water, Wi-Fi, Indah Water, additional
 *                         deductions (repairs and other owner-charged costs), and, when the unit's contract says so,
 *                         miscellaneous charges of RM 100 a month scaled by occupancy (RM 96.67 at 96.67%).
 *  = Net income
 *    then the contract:
 *    - share (profit share 75/20/5, or a management fee "15% To Operator"): the owner gets OWNER% of the net
 *      income; the rest is the operator's (management and agent). Package D: the owner gets at least the monthly
 *      minimum guarantee (prorated by the days it applies); what the company adds to reach it is a top-up.
 *    - fixed rent (long term / GRR): the owner gets the rent, prorated by the contract days in the month; the
 *      income and costs are the company's.
 *  = Payout before O2 adjustment
 *  + Owner adjustments (O2): credits and charges after the split, e.g. "MAINTENANCE FEE SEPT 26".
 *  = Net payout to owner
 *
 *  Rounding: as on the owner's printed report. Income and each deduction are rounded to the sen (income from the
 *  exact night split, miscellaneous charges from the exact occupancy); net income = income - deductions; the owner's
 *  share = net x OWNER%, rounded; the operator's share is the rest. Every line on the page can be checked by hand
 *  and the statement adds up to the sen. */
import { prorate, nightsInWindow, daysInMonth, monthEndExclusive } from './revenue';

export type Query = <T = any>(sql: string, ...args: unknown[]) => Promise<T[]>;

/** Half away from zero, as the workbook (Google Sheets ROUND) shows money; immune to 2444.9255 being 2444.92549999. */
export const roundSen = (x: number) => Math.sign(x) * Math.round(Number(Math.abs(x).toFixed(6)));

export const DEDUCTIONS = [
  ['cleaning_basic', 'Basic Cleaning Fee', 'sessions'],
  ['cleaning_deep', 'Deep Cleaning Fee', 'sessions'],
  ['electricity', 'Electricity Usage', 'months'],
  ['water', 'Water Usage', 'months'],
  ['internet', 'Wi-Fi Subscription Fee', 'months'],
  ['sewerage', 'IndahWater Usage', 'tasks'],
  ['additional', 'Additional Deduction', 'tasks'],
  ['misc', 'Miscellaneous Charges', 'services'],
] as const;
export type DeductionCategory = typeof DEDUCTIONS[number][0];

export interface UnitRow {
  id: string; owner_id: string; owner_name: string; unit_number: string; unit_code: string | null; property_name: string; address: string | null;
  package: string | null; term: string | null; split_kind: string | null; split_value: number | null; unit_misc: number | null;
  contract_id: string | null; model: string | null; management_fee_pct: number | null; grr_amount: number | null;
  starts_on: string | null; ends_on: string | null; minimum_guarantee: number | null; guarantee_starts_on: string | null; guarantee_ends_on: string | null;
  contract_misc: number | null;
}
export interface StayRow { id: string; unit_id: string; check_in: string; check_out: string; collected_revenue: number; channel: string; external_ref: string | null; guest_name: string | null }
export interface CostRow { id: string; unit_id: string; category: string; description: string; amount: number; incurred_on: string; reference: string | null; task_kind: string | null }
export interface AdjustmentRow { id: string; owner_id: string; unit_id: string | null; kind: string; amount: number; description: string; occurred_on: string; reference: string | null; state: string; statement_id: string | null }

export interface Terms {
  basis: 'share' | 'fixed_rent'; source: 'contract' | 'unit' | 'default';
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
    if (u.model === 'grr') return { ...base, basis: 'fixed_rent', source: 'contract', ownerPct: null, fixedRent: Number(u.grr_amount ?? 0), guarantee: 0 };
    return { ...base, basis: 'share', source: 'contract', ownerPct: 100 - Number(u.management_fee_pct ?? defaultFeePct), fixedRent: 0, guarantee: Number(u.minimum_guarantee ?? 0) };
  }
  const none = { activeFrom: null, activeTo: null, guaranteeFrom: null, guaranteeTo: null, miscCharges };
  if (/grr|guaranteed rent/i.test(u.split_kind ?? '') && Number(u.split_value) > 0) return { ...none, basis: 'fixed_rent', source: 'unit', ownerPct: null, fixedRent: Number(u.split_value), guarantee: 0 };
  if (/profit share/i.test(u.split_kind ?? '') && u.split_value !== null && Number(u.split_value) >= 0 && Number(u.split_value) <= 100) {
    return { ...none, basis: 'share', source: 'unit', ownerPct: Number(u.split_value), fixedRent: 0, guarantee: 0 };
  }
  return { ...none, basis: 'share', source: 'default', ownerPct: 100 - defaultFeePct, fixedRent: 0, guarantee: 0 };
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
  if (cat === 'utilities' && /indah|sewer|iwk/i.test(d)) return 'sewerage';
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

/** One unit, one month. `stays`, `costs` and `adjustments` may hold other months and units: only what belongs here is used.
 *  adjustments: pass the ones to put on this statement (the caller decides: open ones for a new statement, dated ones for history). */
export function computeUnitMonth(month: string, unit: UnitRow, terms: Terms, stays: StayRow[], costs: CostRow[], adjustments: AdjustmentRow[], miscMonthly: number): UnitMonth {
  const start = `${month}-01`, endEx = monthEndExclusive(month), days = daysInMonth(month), end = new Date(Date.parse(`${endEx}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const lines: Line[] = [];

  // Income: each stay's nights in the month and that share of its payout.
  const mine = stays.filter(s => s.unit_id === unit.id).map(s => {
    const total = nightsInWindow(s.check_in, s.check_out, ymd(s.check_in), ymd(s.check_out));
    const n = nightsInWindow(ymd(s.check_in), ymd(s.check_out), start, endEx);
    return { s, n, exact: prorate(Number(s.collected_revenue), n, total) };
  }).filter(x => x.n > 0).sort((a, b) => a.s.check_in.localeCompare(b.s.check_in));
  const nights = mine.reduce((n, x) => n + x.n, 0);
  const grossExact = mine.reduce((n, x) => n + x.exact, 0);
  const gross = roundSen(grossExact);
  // Each stay's line is rounded so that the lines add up to the rounded total (largest remainder).
  const floors = mine.map(x => Math.floor(x.exact));
  let left = gross - floors.reduce((a, b) => a + b, 0);
  const order = mine.map((x, i) => [i, x.exact - floors[i]] as const).sort((a, b) => b[1] - a[1]);
  for (const [i] of order) { if (left <= 0) break; floors[i]++; left--; }
  if (left < 0) floors[floors.length - 1] += left;

  // Deductions, by the workbook's rows.
  const myCosts = costs.filter(c => c.unit_id === unit.id && c.incurred_on >= start && c.incurred_on < endEx).sort((a, b) => a.incurred_on.localeCompare(b.incurred_on));
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
  if (terms.basis === 'fixed_rent') {
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
  const label = `${unit.property_name} ${unit.unit_number}`;
  if (terms.basis === 'share') {
    mine.forEach((x, i) => lines.push({
      type: 'gross', category: 'hospitality', unitId: unit.id, reservationId: x.s.id, quantity: x.n, amount: floors[i], occurredOn: x.s.check_in > start ? ymd(x.s.check_in) : start,
      description: `${label} · ${x.s.guest_name || 'Guest'} · ${ymd(x.s.check_in)} to ${ymd(x.s.check_out)}${x.n !== nightsInWindow(ymd(x.s.check_in), ymd(x.s.check_out), ymd(x.s.check_in), ymd(x.s.check_out)) ? ` (${x.n} ${x.n === 1 ? 'night' : 'nights'} in ${month})` : ''}`,
      reference: x.s.external_ref,
    }));
    for (const c of myCosts) lines.push({
      type: 'expense', category: classifyCost(c), unitId: unit.id, expenseId: c.id, quantity: 1, amount: -Number(c.amount), occurredOn: c.incurred_on,
      description: c.description || c.category, reference: c.reference,
    });
    if (misc) lines.push({ type: 'expense', category: 'misc', unitId: unit.id, quantity: occupancy, amount: -misc, occurredOn: end,
      description: `Miscellaneous charges (RM ${(miscMonthly / 100).toFixed(2)} x ${(occupancy * 100).toFixed(2)}% occupancy)` });
    if (operatorShare) lines.push({ type: 'management_fee', category: 'operator_share', unitId: unit.id, quantity: null, amount: -operatorShare, occurredOn: end,
      description: `${fmtPct(100 - (terms.ownerPct ?? 0))} to operator` });
    if (topUp) lines.push({ type: 'adjustment', category: 'guarantee_top_up', unitId: unit.id, quantity: null, amount: topUp, occurredOn: end,
      description: `Minimum guarantee top-up (guaranteed RM ${(guarantee / 100).toFixed(2)})` });
  } else if (fixedRent) {
    lines.push({ type: 'adjustment', category: 'fixed_rent', unitId: unit.id, quantity: null, amount: fixedRent, occurredOn: end, description: `${label}: fixed monthly rent` });
  }
  const mineAdj = adjustments.filter(a => a.unit_id === unit.id);
  for (const a of mineAdj) lines.push({
    type: 'adjustment', category: Number(a.amount) >= 0 ? 'owner_credit' : 'owner_charge', unitId: unit.id, adjustmentId: a.id, quantity: null,
    amount: Number(a.amount), occurredOn: a.occurred_on, description: a.description.replace(/^O2:\s*/i, ''), reference: a.reference,
  });
  const adjustmentsTotal = mineAdj.reduce((n, a) => n + Number(a.amount), 0);
  const warnings: string[] = [];
  const unpaid = mine.filter(x => !(Number(x.s.collected_revenue) > 0));
  if (unpaid.length) warnings.push(`${unpaid.length} ${unpaid.length === 1 ? 'stay has' : 'stays have'} no payout recorded (${unpaid.reduce((n, x) => n + x.n, 0)} nights counted at RM 0): ${unpaid.map(x => `${x.s.check_in} to ${x.s.check_out}`).join(', ')}.`);
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
export const hasActivity = (m: UnitMonth) => m.nights > 0 || m.deductions !== 0 || m.adjustmentIds.length > 0 || m.fixedRent !== 0 || m.guarantee !== 0;

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export interface Inputs { units: UnitRow[]; stays: StayRow[]; costs: CostRow[]; adjustments: AdjustmentRow[] }

export const UNIT_SQL = `
  SELECT u.id, u.owner_id, o.display_name AS owner_name, u.unit_number, u.unit_code, p.name AS property_name, u.address,
         u.package, u.term, u.split_kind, u.split_value, u.misc_charges AS unit_misc,
         c.id AS contract_id, c.model, c.management_fee_pct, c.grr_amount, c.starts_on, c.ends_on,
         c.minimum_guarantee, c.guarantee_starts_on, c.guarantee_ends_on, c.misc_charges AS contract_misc
  FROM units u JOIN properties p ON p.id = u.property_id JOIN owners o ON o.id = u.owner_id
  LEFT JOIN owner_contracts c ON c.id = u.contract_id`;

/** Everything needed for [from, toExclusive), for every unit, some owners' units, or one unit. Five queries. */
export async function loadInputs(q: Query, from: string, toExclusive: string, scope: { ownerIds?: string[]; unitId?: string } = {}): Promise<Inputs> {
  const unitWhere = scope.unitId ? 'WHERE u.id = ?' : scope.ownerIds ? 'WHERE u.owner_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))' : '';
  const unitArg = scope.unitId ? [scope.unitId] : scope.ownerIds ? [JSON.stringify(scope.ownerIds)] : [];
  const units = await q<UnitRow>(`${UNIT_SQL} ${unitWhere} ORDER BY p.name, u.unit_number`, ...unitArg);
  const ids = JSON.stringify(units.map(u => u.id));
  const [stays, costs, adjustments] = await Promise.all([
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
  ]);
  return {
    units,
    stays: stays.map(s => ({ ...s, check_in: ymd(s.check_in), check_out: ymd(s.check_out), collected_revenue: Number(s.collected_revenue) })),
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
    const adj = adjustmentsFor(inputs.adjustments, ownerId, month, mode, statementIdOf(ownerId), units[0]?.id ?? null);
    for (const u of units) out.push(computeUnitMonth(month, u, termsFor(u, settings.defaultFeePct), stays, costs, adj, settings.miscMonthly));
  }
  return out;
}
