import { type Env, all } from './db';
import { monthEndExclusive } from './revenue';
import { loadInputs, withYearToDate, computeMonth, statementSettings, fmtPct, classifyCost, DEDUCTIONS, type Query } from './ownerStatement';
import { unitExample } from './unitContract';
import { DEDUCTION_WORDS } from './unitCosts';
import { hasCleanPrices } from './cleaningPrices';
import { hasBilling } from './maintenance';

export type Item = { label: string; amount: number };
export type PnlRow = { label: string; amount: number; type: string; items?: Item[] };

const PAYER_LABEL: Record<string, string> = { owner: 'Owner', the_conts: 'The Conts', tenant: 'Tenant', guest_deposit: 'Guest', warranty: 'Warranty' };
const CATEGORY_LABEL: Record<string, string> = {
  electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water', cleaning: 'Cleaning', housekeeping: 'Cleaning',
  maintenance: 'Maintenance', utilities: 'Utilities', other: 'Misc', consumables: 'Consumables', furniture: 'Furniture',
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const CHANNEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', agoda: 'Agoda', direct: 'Direct' };
/** A row's amount, never a negative zero (it would print as "- RM 0.00"). */
const neg = (n: number) => (n ? -n : 0);

/** A query function that asks each distinct query once per request (a Worker holds at most six connections). */
export function cachedQuery(env: Env): Query {
  const asked = new Map<string, Promise<any[]>>();
  return ((sql: string, ...args: unknown[]) => {
    const key = JSON.stringify([sql, args]);
    if (!asked.has(key)) asked.set(key, all(env, sql, ...args));
    return asked.get(key)!;
  }) as Query;
}

/**
 * One unit's month in two P&Ls, as the unit record's Financials shows them (owner, 11 Oct 2026, request U4):
 *  - pnl: the owner statement for the month, every line: the reservations, each deduction the statement has (cleaning,
 *    deep cleaning, electricity, water, Wi-Fi, IndahWater, maintenance and other fees, misc) even when nil, the
 *    operator's share, top-up, owner adjustments and the net payout. A GRR unit's statement is the fixed rent.
 *  - companyPnl: The Conts' side. On a GRR or master lease unit it is the full P&L under the fixed rent: every
 *    reservation, every cost on the unit by kind whoever paid it, the rent to the owner and the result.
 * Money rules are ownerStatement.ts's; nothing here computes a statement figure of its own.
 */
export async function unitMonthPnl(env: Env, q: Query, unitId: string, month: string): Promise<{ pnl?: PnlRow[]; companyPnl?: PnlRow[] }> {
  const from = `${month}-01`, toEx = monthEndExclusive(month);
  const [settings, inputs, example, costs] = await Promise.all([
    statementSettings(q),
    loadInputs(q, from, toEx, { unitId }),
    unitExample(q, unitId, month),
    // Every cost on the unit in the month, whoever paid it, with the cleaning job kind so it classifies as the statement does.
    all<any>(env, `SELECT e.category, e.charge_to, e.description, e.amount, e.incurred_on, t.kind AS task_kind
      FROM expenses e LEFT JOIN tasks t ON t.id = e.task_id
      WHERE e.unit_id = ? AND e.incurred_on >= ? AND e.incurred_on < ? ORDER BY e.incurred_on`, unitId, from, toEx),
  ]);
  const m = computeMonth(month, await withYearToDate(q, inputs, month, settings), settings, 'dated').find(x => x.unitId === unitId) ?? null;
  if (!m) return {};
  const channelOf = new Map(inputs.stays.map(st => [st.id, st.channel]));

  const grossItems = (lines: typeof m.lines): Item[] => lines.filter(l => l.type === 'gross').map(l => {
    // The generator writes "<unit> · <guest> · <in> to <out>": the unit is already the page's, so it is left off.
    const s2 = /(?:^|· )([^·]*?) · (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(l.description);
    const ch = l.reservationId ? CHANNEL[channelOf.get(l.reservationId) ?? ''] ?? null : null;
    const nights = l.quantity != null ? `${l.quantity} ${l.quantity === 1 ? 'night' : 'nights'}` : null;
    return { label: s2 ? [s2[1], `${dm(s2[2])} – ${dm(s2[3])}`, nights, ch].filter(Boolean).join(' · ') : l.description, amount: l.amount };
  });
  const orNone = (items: Item[]) => (items.length ? items : [{ label: 'No reservations this month', amount: 0 }]);
  const expenseItems = (category: string): Item[] => m.lines.filter(l => l.type === 'expense' && l.category === category)
    .map(l => ({ label: `${l.description} · ${dm(l.occurredOn)}`, amount: l.amount }));
  const ownerAdjustments = m.lines.filter(l => l.type === 'adjustment' && !['guarantee_top_up', 'fixed_rent'].includes(l.category ?? ''))
    .map(l => ({ label: `${l.description} · ${dm(l.occurredOn)}`, amount: l.amount }));

  const pnl: PnlRow[] = m.terms.basis === 'none'
    ? [{ label: 'Master lease: no owner statement', amount: 0, type: 'gross' }]
    : m.terms.basis === 'fixed_rent'
    ? [{ label: 'Fixed monthly rent', amount: m.fixedRent, type: 'gross' }]
    : [
      { label: m.terms.model === 'long_term' ? 'Gross Income (monthly rent from tenant)' : 'Gross Income (reservations)', amount: m.gross, type: 'gross',
        items: m.terms.model === 'long_term' ? undefined : orNone(grossItems(m.lines)) },
      // Every deduction the statement has, nil ones too, so the month reads the same shape every time.
      ...m.deductionGroups.map(g => ({ label: DEDUCTION_WORDS[g.category] ?? g.label, amount: neg(g.amount), type: 'expense',
        items: g.category === 'misc' ? undefined : expenseItems(g.category) })),
      { label: m.terms.model === 'long_term' ? `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator (of the rent)` : `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator`, amount: neg(m.operatorShare), type: 'fee' },
      ...(m.topUp ? [{ label: 'Minimum Guarantee Top-up', amount: m.topUp, type: 'adjustment' }] : []),
    ];
  // The owner's credits and charges come off after the split, as on every statement already sent.
  if (m.adjustmentsTotal) pnl.push({ label: m.adjustmentsTotal < 0 ? 'Owner Adjustments (charges), after the split' : 'Owner Adjustments (credits), after the split', amount: m.adjustmentsTotal, type: 'adjustment', items: ownerAdjustments });
  pnl.push({ label: 'Net Payout to Owner', amount: m.netPayout, type: 'net' });

  if (!example) return { pnl };
  let companyPnl: PnlRow[];
  if (example.company) {
    // What the unit traded: the same night split of the stays on a share basis with nothing to the owner (unitExample).
    const unit = inputs.units.find(u => u.id === unitId)!;
    const trading = computeMonth(month, { ...inputs, units: [{ ...unit, contract_id: 'trading', revenue_model: 'management', model: 'management', management_fee_pct: 100, minimum_guarantee: 0, contract_misc: 0, unit_misc: 0, history: undefined }] }, settings, 'dated')[0];
    const byKind = new Map<string, Item[]>();
    for (const c of costs) {
      const k = classifyCost(c);
      byKind.set(k, [...(byKind.get(k) ?? []), { label: `${c.description || CATEGORY_LABEL[c.category] || c.category} · ${dm(String(c.incurred_on))} · paid by ${PAYER_LABEL[c.charge_to] ?? c.charge_to}`, amount: -Number(c.amount) }]);
    }
    companyPnl = [
      { label: 'Unit income (reservations)', amount: example.company.income, type: 'gross', items: orNone(grossItems(trading.lines)) },
      ...DEDUCTIONS.filter(([k]) => k !== 'misc').map(([k, label]) => {
        const items = byKind.get(k) ?? [];
        return { label: DEDUCTION_WORDS[k] ?? label, amount: items.reduce((n, i) => n + i.amount, 0), type: 'expense', items };
      }),
      { label: m.terms.model === 'master_lease' ? 'Lease rent paid to owner' : 'Guaranteed rent paid to owner', amount: neg(example.company.rentToOwner), type: 'fee' },
      { label: "The Conts' result", amount: example.company.result, type: 'net' },
    ];
  } else {
    // One row per kind and payer, largest first, with every bill under it: costs others paid never reach the owner.
    const byPayer = new Map<string, Item[]>();
    for (const r of costs.filter(c => c.charge_to !== 'owner')) {
      const k = `${CATEGORY_LABEL[r.category] ?? r.category} (paid by ${PAYER_LABEL[r.charge_to] ?? r.charge_to})`;
      byPayer.set(k, [...(byPayer.get(k) ?? []), { label: `${r.description || CATEGORY_LABEL[r.category] || r.category} · ${dm(String(r.incurred_on))}`, amount: -Number(r.amount) }]);
    }
    const others: PnlRow[] = [...byPayer.entries()].map(([label, items]) => ({ label, amount: items.reduce((n, i) => n + i.amount, 0), type: 'expense', items }))
      .sort((a, b) => a.amount - b.amount);
    const othersTotal = others.reduce((n, l) => n + l.amount, 0);
    // Cleaning and repairs the owner paid us for, against what they cost us (the cleaner's pay, the contractor), when that
    // cost is known: the margin is The Conts' (Service prices, owner 17 Oct 2026). The owner statement is unchanged.
    const jobs = await serviceJobs(env, unitId, from, toEx);
    const charged = jobs.reduce((n, j) => n + j.owner, 0), cost = jobs.reduce((n, j) => n + j.internal, 0);
    const service: PnlRow[] = jobs.length ? [
      { label: 'Cleaning and repairs charged to the owner', amount: charged, type: 'gross', items: jobs.map(j => ({ label: `${j.label} · ${dm(j.day)}`, amount: j.owner })) },
      { label: 'Their internal cost (cleaner pay, contractors)', amount: neg(cost), type: 'expense', items: jobs.map(j => ({ label: `${j.label} · ${dm(j.day)}`, amount: neg(j.internal) })) },
    ] : [];
    companyPnl = [
      { label: m.terms.model === 'long_term' ? 'Operator share' : `${fmtPct(100 - (m.ownerPct ?? 0))} To Operator (management and agent)`, amount: m.operatorShare, type: 'gross' },
      ...(m.topUp ? [{ label: 'Minimum guarantee top-up paid', amount: -m.topUp, type: 'fee' }] : []),
      ...service,
      ...others,
      { label: "The Conts' result", amount: m.operatorShare - m.topUp + othersTotal + charged - cost, type: 'net' },
    ];
  }
  return { pnl, companyPnl };
}

/** The owner-paid cleans and repairs on a unit in [from, toEx) whose internal cost is known: what the owner was charged
 *  (the expense) and what the job cost us (tasks.cleaner_pay, maintenance_issues.contractor_amount). */
async function serviceJobs(env: Env, unitId: string, from: string, toEx: string): Promise<{ label: string; day: string; owner: number; internal: number }[]> {
  const [cleans, repairs] = await Promise.all([
    hasCleanPrices(env).then(ok => !ok ? [] : all<any>(env, `
      SELECT e.description, e.incurred_on, e.amount, t.cleaner_pay FROM expenses e JOIN tasks t ON t.id = e.task_id
      WHERE e.unit_id = ? AND e.charge_to = 'owner' AND e.incurred_on >= ? AND e.incurred_on < ? AND t.cleaner_pay IS NOT NULL ORDER BY e.incurred_on`, unitId, from, toEx)),
    hasBilling(env).then(ok => !ok ? [] : all<any>(env, `
      SELECT m.title AS description, min(e.incurred_on) AS incurred_on, SUM(e.amount) AS amount, m.contractor_amount AS cleaner_pay
      FROM expenses e JOIN maintenance_issues m ON m.id = e.maintenance_id
      WHERE e.unit_id = ? AND e.charge_to = 'owner' AND e.incurred_on >= ? AND e.incurred_on < ? AND m.contractor_amount IS NOT NULL
      GROUP BY m.id, m.title, m.contractor_amount ORDER BY min(e.incurred_on)`, unitId, from, toEx)),
  ]);
  return [...cleans, ...repairs].map(r => ({ label: r.description || 'Service', day: String(r.incurred_on).slice(0, 10), owner: Number(r.amount), internal: Number(r.cleaner_pay) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
