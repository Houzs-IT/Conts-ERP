import { type Env, all, fail, audit } from '../../_lib/db';
import { requireSession, canSeeFinance } from '../../_lib/auth';

const q = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** GET /api/expenses/report?unitId=&period=YYYY-MM — a CSV download. Filters applied and generation time are printed at the top. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!canSeeFinance(session.role)) return fail('FORBIDDEN', 'Expense reports are for finance and management roles.', 403);

  const url = new URL(request.url);
  const unitId = url.searchParams.get('unitId') || null, period = url.searchParams.get('period') || null;
  if (period && !/^\d{4}-\d{2}$/.test(period)) return fail('VALIDATION', 'Period must be YYYY-MM.', 422);

  const rows = await all<any>(env, `
    SELECT e.id, e.category, e.description, e.amount, e.incurred_on, e.reference, e.charge_to, u.unit_number, p.name AS property_name
    FROM expenses e JOIN units u ON u.id = e.unit_id JOIN properties p ON p.id = u.property_id
    WHERE 1 = 1 ${unitId ? 'AND e.unit_id = ?' : ''} ${period ? 'AND substr(e.incurred_on, 1, 7) = ?' : ''}
    ORDER BY e.incurred_on, p.name, u.unit_number`, ...[unitId, period].filter((v): v is string => !!v));

  const total = rows.reduce((n, r) => n + Number(r.amount), 0);
  const generated = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });
  const lines = [
    [q('Conts ERP - Expenses report')],
    [q('Filters applied'), q(`Unit: ${unitId ?? 'all'}; Period: ${period ?? 'all'}`)],
    [q('Generated'), q(`${generated} MYT`)],
    [q('Rows'), q(rows.length)],
    [''],
    ['Expense', 'Unit', 'Property', 'Category', 'Date', 'Reference', 'Description', 'Amount (RM)', 'Charge to'].map(q),
    ...rows.map(r => [q(r.id), q(r.unit_number), q(r.property_name), q(r.category), q(r.incurred_on), q(r.reference), q(r.description), q((Number(r.amount) / 100).toFixed(2)), q(r.charge_to)]),
    ['', '', '', '', '', '', q('Total'), q((total / 100).toFixed(2)), ''],
  ].map(l => l.join(','));

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.report', entityTable: 'expenses', entityId: 'report', after: { unitId, period, rows: rows.length } });
  return new Response('﻿' + lines.join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="expenses-${period ?? 'all'}.csv"`, 'cache-control': 'no-store' },
  });
};
