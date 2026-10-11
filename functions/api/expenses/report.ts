import { type Env, all, one, fail, audit, mytToday } from '../../_lib/db';
import { hhmm } from '../../_lib/ops';
import { requireSession } from '../../_lib/auth';
import { csvCell } from '../../_lib/csv';
import { readExpenseFilter, expenseWhere, IS_PARENT_SQL } from '../../_lib/expenses';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => /^\d{4}-\d{2}$/.test(ym) ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : ym;
const dayName = (d: string | null) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(8, 10))} ${monthName(d.slice(0, 7))}` : (d ?? '');
// A code such as management_fee reads as "Management fee"; the generated time reads like the rest of the app, not 11/10/2026.
const label = (code: string | null) => code ? code.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '';
const CHARGE: Record<string, string> = { owner: 'Owner', guest_deposit: 'Guest deposit', the_conts: 'The Conts', warranty: 'Warranty' };
const q = (v: string | number | null) => csvCell(v);

/** GET /api/expenses/report?month=YYYY-MM&category=&building=&unit=&owner=&q= (also the older unitId= / period=) — a CSV download. Filters applied and generation time are printed at the top. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Expense reports are for finance and management roles.', 403);

  const f = readExpenseFilter(new URL(request.url));
  if (typeof f === 'string') return fail('VALIDATION', f, 422);
  const where = expenseWhere(f);
  // Rollup headers carry no money of their own; their line items are listed instead.
  const rows = await all<any>(env, `
    SELECT e.id, e.category, e.description, e.amount, e.incurred_on, e.reference, e.charge_to, u.unit_number, p.name AS property_name
    FROM expenses e JOIN units u ON u.id = e.unit_id JOIN properties p ON p.id = u.property_id
    WHERE NOT ${IS_PARENT_SQL} ${where.sql}
    ORDER BY e.incurred_on, p.name, u.unit_number`, ...where.args);
  // Print names, not ids, so the header reads on its own.
  const name = async (sql: string, id: string | null) => id ? ((await one<{ n: string }>(env, sql, id))?.n ?? id) : 'all';
  const scope = [
    `Month: ${f.month ? monthName(f.month) : 'all'}`, `Category: ${f.category ? label(f.category) : 'all'}`,
    `Building: ${await name('SELECT name AS n FROM properties WHERE id = ?', f.building)}`,
    `Unit: ${await name("SELECT p.name || ' ' || u.unit_number AS n FROM units u JOIN properties p ON p.id = u.property_id WHERE u.id = ?", f.unit)}`,
    `Owner: ${await name('SELECT display_name AS n FROM owners WHERE id = ?', f.owner)}`,
    ...(f.q ? [`Search: ${f.q}`] : []),
  ].join('; ');

  const total = rows.reduce((n, r) => n + Number(r.amount), 0);
  const generated = `${dayName(mytToday())} ${hhmm(new Date().toISOString())}`;
  const lines = [
    [q('Conts ERP - Expenses report')],
    [q('Filters applied'), q(scope)],
    [q('Generated'), q(`${generated} MYT`)],
    [q('Rows'), q(rows.length)],
    [''],
    ['Expense', 'Unit', 'Property', 'Category', 'Date', 'Reference', 'Description', 'Amount (RM)', 'Charge to'].map(q),
    ...rows.map(r => [q(r.id), q(r.unit_number), q(r.property_name), q(label(r.category)), q(r.incurred_on), q(r.reference), q(r.description), q((Number(r.amount) / 100).toFixed(2)), q(CHARGE[r.charge_to] ?? label(r.charge_to))]),
    ['', '', '', '', '', '', q('Total'), q((total / 100).toFixed(2)), ''],
  ].map(l => l.join(','));

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.report', entityTable: 'expenses', entityId: 'report', after: { ...f, rows: rows.length } });
  return new Response('﻿' + lines.join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="expenses-${f.month ?? 'all'}.csv"`, 'cache-control': 'no-store' },
  });
};
