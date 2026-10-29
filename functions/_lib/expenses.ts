import { type Env, one, all } from './db';
import { firstOpenMonth } from '../../src/lib/deductMonth';

export const EXPENSE_CATEGORIES = ['internet', 'electricity', 'water', 'sewerage', 'cleaning', 'housekeeping', 'maintenance', 'utilities', 'consumables', 'furniture', 'management_fee', 'channel_fee', 'other'];
/** Who pays an expense ("Paid by" on screen). Only 'owner' reaches the owner statement; the rest stay in the unit's
 *  own profit and loss. owner = Owner (via statement), the_conts = Company, tenant = Tenant, guest_deposit = Guest. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Words for approval summaries and reports, which are read by people: "Indah Water, 5 Oct 2026", never "sewerage, 2026-10-05". */
export function expenseCategoryLabel(c: string | null | undefined) {
  if (!c) return 'Expense';
  return c === 'sewerage' ? 'Indah Water' : c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase());
}
export function expenseDayLabel(d: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(d ?? '');
}
export const CHARGE_TO = ['owner', 'the_conts', 'tenant', 'guest_deposit', 'warranty'];

/** Utility bills keep the month on the bill and, when that month is already final, go on the next open statement
 *  (spec docs/superpowers/specs/2026-10-27-utility-bills-design.md §3). Every other expense still needs an open month. */
export const UTILITY_KINDS = ['electricity', 'water', 'internet', 'sewerage'];
export const isUtility = (category: string | null | undefined) => UTILITY_KINDS.includes(String(category ?? ''));

/** SQL: true when the expense can no longer change: the owner statement that deducts it (its deduction month: the
 *  month of its date, or a later one for a utility bill that came after its month was final) is finalised, sent or
 *  paid. Alias `e` is the expense and `u` its unit. */
export const LOCKED_SQL = `EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = u.owner_id AND s.state IN ('finalised','sent','paid')
   AND e.deduct_month || '-01' >= s.period_start AND e.deduct_month || '-01' <= s.period_end)`;

/** For each unit, the YYYY-MM months from `fromMonth` on whose owner statement is final. */
export async function finalMonthsFor(env: Env, unitIds: string[], fromMonth: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!unitIds.length) return out;
  const rows = await all<{ unit_id: string; month: string }>(env, `
    SELECT DISTINCT u.id AS unit_id, substr(s.period_start, 1, 7) AS month FROM owner_statements s JOIN units u ON u.owner_id = s.owner_id
    WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND s.state IN ('finalised','sent','paid') AND s.period_end >= ?`,
    JSON.stringify([...new Set(unitIds)]), `${fromMonth}-01`);
  for (const r of rows) { const s = out.get(r.unit_id) ?? new Set<string>(); s.add(r.month); out.set(r.unit_id, s); }
  return out;
}

/** Which statement deducts a utility bill on this unit dated `date`: its own month, or the next open one (rolled). */
export async function utilityDeduction(env: Env, unitId: string, date: string): Promise<{ deductMonth: string; rolled: boolean }> {
  const month = date.slice(0, 7);
  const deductMonth = firstOpenMonth(month, (await finalMonthsFor(env, [unitId], month)).get(unitId) ?? new Set());
  return { deductMonth, rolled: deductMonth !== month };
}

/** Is this expense on (or due on) a statement that is final? See LOCKED_SQL. */
export async function isExpenseLocked(env: Env, e: { unit_id: string; deduct_month: string }): Promise<boolean> {
  return isPeriodLocked(env, e.unit_id, `${e.deduct_month}-01`);
}

/** Is a new or changed expense on this unit and date inside a statement that is already final? */
export async function isPeriodLocked(env: Env, unitId: string, date: string): Promise<boolean> {
  const row = await one(env, `
    SELECT 1 AS x FROM owner_statements s JOIN units u ON u.owner_id = s.owner_id
    WHERE u.id = ? AND s.state IN ('finalised','sent','paid') AND ? >= s.period_start AND ? <= s.period_end LIMIT 1`, unitId, date, date);
  return !!row;
}

/** isPeriodLocked for many units on one date, in one query: the unit ids whose statement for that date is final. */
export async function lockedUnits(env: Env, unitIds: string[], date: string): Promise<Set<string>> {
  if (!unitIds.length) return new Set();
  const rows = await all<{ unit_id: string }>(env, `
    SELECT DISTINCT u.id AS unit_id FROM owner_statements s JOIN units u ON u.owner_id = s.owner_id
    WHERE u.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND s.state IN ('finalised','sent','paid') AND ? >= s.period_start AND ? <= s.period_end`,
    JSON.stringify([...new Set(unitIds)]), date, date);
  return new Set(rows.map(r => r.unit_id));
}

const MONTH = /^\d{4}-\d{2}$/;
/** YYYY-MM moved by whole months. */
export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const nextMonth = (ym: string) => shiftMonth(ym, 1);

export interface ExpenseFilter {
  month: string | null; category: string | null; building: string | null; unit: string | null; owner: string | null; q: string | null;
}

/** Reads the shared expense filters from a query string. `month` is YYYY-MM or absent for every month. */
export function readExpenseFilter(url: URL): ExpenseFilter | string {
  const p = (k: string) => url.searchParams.get(k)?.trim() || null;
  const month = p('month') ?? p('period');
  if (month && month !== 'all' && !MONTH.test(month)) return 'Month must look like 2026-08.';
  return { month: month === 'all' ? null : month, category: p('category'), building: p('building'), unit: p('unit') ?? p('unitId'), owner: p('owner'), q: p('q') };
}

/** WHERE clause over expenses `e` joined to units `u` and properties `p`. `skip` leaves one filter out,
 *  so a chip row can show counts for every category while one is selected. */
export function expenseWhere(f: ExpenseFilter, skip?: keyof ExpenseFilter): { sql: string; args: unknown[] } {
  const parts: string[] = [], args: unknown[] = [];
  // Range on the text date (YYYY-MM-DD) rather than substr(), so the (unit_id, incurred_on) index stays usable.
  if (f.month && skip !== 'month') { parts.push('e.incurred_on >= ? AND e.incurred_on < ?'); args.push(`${f.month}-01`, `${nextMonth(f.month)}-01`); }
  if (f.category && skip !== 'category') { parts.push('e.category = ?'); args.push(f.category); }
  if (f.building && skip !== 'building') { parts.push('u.property_id = ?'); args.push(f.building); }
  if (f.unit && skip !== 'unit') { parts.push('e.unit_id = ?'); args.push(f.unit); }
  if (f.owner && skip !== 'owner') { parts.push('u.owner_id = ?'); args.push(f.owner); }
  if (f.q && skip !== 'q') {
    parts.push(`(e.description ILIKE ? OR e.reference ILIKE ? OR u.unit_number ILIKE ? OR p.name ILIKE ?)`);
    const like = `%${f.q.replace(/[%_\\]/g, m => '\\' + m)}%`;
    args.push(like, like, like, like);
  }
  return { sql: parts.length ? 'AND ' + parts.join(' AND ') : '', args };
}

/** SQL: true when the expense `e` is a rollup header whose line items carry its money. */
export const IS_PARENT_SQL = 'EXISTS (SELECT 1 FROM expenses k WHERE k.parent_expense_id = e.id)';
