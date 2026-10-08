import { type Env, all, one, json, fail, nowIso } from '../../_lib/db';
import { todayMyt } from '../../_lib/ops';
import { requireSession } from '../../_lib/auth';
import { LOCKED_SQL, IS_PARENT_SQL, readExpenseFilter, expenseWhere, shiftMonth } from '../../_lib/expenses';

const SORTS: Record<string, string> = {
  date: 'e.incurred_on DESC, e.created_at DESC, e.id',
  date_asc: 'e.incurred_on ASC, e.created_at ASC, e.id',
  amount: 'e.amount DESC, e.incurred_on DESC, e.id',
  amount_asc: 'e.amount ASC, e.incurred_on DESC, e.id',
  unit: 'p.name, u.unit_number, e.incurred_on DESC, e.id',
};

const FROM = 'FROM expenses e JOIN units u ON u.id = e.unit_id JOIN properties p ON p.id = u.property_id';

const shape = (r: any) => ({
  id: r.id, unitId: r.unit_id, unitNumber: r.unit_number, propertyName: r.property_name,
  category: r.category, description: r.description, amount: Number(r.amount),
  incurredOn: r.incurred_on, reference: r.reference, chargeTo: r.charge_to,
  parentExpenseId: r.parent_expense_id ?? null, locked: !!r.locked,
});

/** GET /api/finance/expenses?month=YYYY-MM|all&category=&building=&unit=&owner=&q=&sort=&page=&pageSize=&view=list|tree
 *  One page of expenses plus the totals for everything the filters match, so the screen never has to hold
 *  all of them. `list` returns the money-carrying lines; `tree` (with a category) returns that category's
 *  top-level expenses with their line items, for the grouped view. A rollup header carries no money of its
 *  own, so totals count its line items only. `locked` is true once the covering statement is final. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Expenses are visible to finance and management roles.', 403);

  const url = new URL(request.url);
  if (!url.searchParams.get('month')) {
    // No month asked for: open on the latest month that has expenses (not a future one), so the screen
    // never opens on an empty current month while last month's bills are still being entered.
    const today = todayMyt().slice(0, 7);
    const latest = await one<{ m: string | null }>(env, 'SELECT MAX(substr(incurred_on, 1, 7)) AS m FROM expenses WHERE incurred_on < ?', `${shiftMonth(today, 1)}-01`);
    url.searchParams.set('month', latest?.m ?? today);
  }
  const f = readExpenseFilter(url);
  if (typeof f === 'string') return fail('VALIDATION', f, 422);
  const view = url.searchParams.get('view') === 'tree' ? 'tree' : 'list';
  const sort = SORTS[url.searchParams.get('sort') ?? ''] ? url.searchParams.get('sort')! : 'date';
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const rawSize = url.searchParams.get('pageSize');
  // pageSize=0 returns the totals only (the grouped view's first paint).
  const pageSize = rawSize === '0' ? 0 : Math.min(200, Math.max(1, Math.floor(Number(rawSize)) || 50));

  const where = expenseWhere(f);
  const noCategory = expenseWhere(f, 'category');
  const noMonth = expenseWhere(f, 'month');

  const rowsQuery = pageSize === 0 ? Promise.resolve([] as any[]) : view === 'list'
    ? all<any>(env, `
        SELECT e.*, u.unit_number, p.name AS property_name, ${LOCKED_SQL} AS locked
        ${FROM} WHERE NOT ${IS_PARENT_SQL} ${where.sql}
        ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`, ...where.args, pageSize, (page - 1) * pageSize)
    : all<any>(env, `
        SELECT e.*, u.unit_number, p.name AS property_name, ${LOCKED_SQL} AS locked,
               (SELECT COUNT(*) FROM expenses k WHERE k.parent_expense_id = e.id) AS child_count,
               COALESCE((SELECT SUM(k.amount) FROM expenses k WHERE k.parent_expense_id = e.id), e.amount) AS rolled
        ${FROM} WHERE e.parent_expense_id IS NULL ${where.sql}
        ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`, ...where.args, pageSize, (page - 1) * pageSize);

  const [rows, totals, byCategory, months, sent] = await Promise.all([
    rowsQuery,
    all<any>(env, `
      SELECT COUNT(*) FILTER (WHERE NOT ${IS_PARENT_SQL}) AS n, COALESCE(SUM(e.amount) FILTER (WHERE NOT ${IS_PARENT_SQL}), 0) AS amount,
             COUNT(*) FILTER (WHERE e.parent_expense_id IS NULL) AS top
      ${FROM} WHERE 1 = 1 ${where.sql}`, ...where.args),
    all<any>(env, `
      SELECT e.category, COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS amount
      ${FROM} WHERE NOT ${IS_PARENT_SQL} ${noCategory.sql} GROUP BY e.category ORDER BY amount DESC`, ...noCategory.args),
    all<any>(env, `
      SELECT substr(e.incurred_on, 1, 7) AS month, COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS amount
      ${FROM} WHERE NOT ${IS_PARENT_SQL} ${noMonth.sql} GROUP BY 1 ORDER BY 1 DESC`, ...noMonth.args),
    all<{ p: string }>(env, `SELECT DISTINCT substr(period_start, 1, 7) AS p FROM owner_statements WHERE state IN ('finalised','sent','paid') ORDER BY p`),
  ]);

  let children: any[] = [];
  if (view === 'tree' && rows.some(r => Number(r.child_count) > 0)) {
    const ids = rows.filter(r => Number(r.child_count) > 0).map(r => r.id);
    children = await all<any>(env, `
      SELECT e.*, u.unit_number, p.name AS property_name, ${LOCKED_SQL} AS locked
      ${FROM} WHERE e.parent_expense_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) ORDER BY e.incurred_on, e.id`, JSON.stringify(ids));
  }

  const t = totals[0] ?? { n: 0, amount: 0, top: 0 };
  return json({
    generatedAt: nowIso(),
    filtersApplied: { month: f.month ?? 'all', category: f.category ?? 'all', building: f.building ?? 'all', unit: f.unit ?? 'all', owner: f.owner ?? 'all', q: f.q ?? '' },
    view, sort, page, pageSize,
    total: Number(t.n), totalAmount: Number(t.amount),
    // Rows the tree pages over (top-level expenses) — differs from `total` only when rollups exist.
    pageTotal: view === 'tree' ? Number(t.top) : Number(t.n),
    byCategory: byCategory.map(c => ({ category: c.category, count: Number(c.n), amount: Number(c.amount) })),
    months: months.map(m => ({ month: m.month, count: Number(m.n), amount: Number(m.amount) })),
    sentPeriods: sent.map(s => s.p),
    data: rows.map(r => ({
      ...shape(r),
      ...(view === 'tree' ? { amount: Number(r.rolled), childCount: Number(r.child_count), children: children.filter(c => c.parent_expense_id === r.id).map(shape) } : {}),
    })),
  });
};
