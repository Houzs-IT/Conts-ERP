import { type Env, all, run, json, fail, audit, nowIso } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { CHARGE_TO, isPeriodLocked } from '../../_lib/expenses';

/** Monthly utility bills by account number: one row per unit utility account (unit_utility_accounts), with what is
 *  already recorded for the month, so a month's TNB, water, Wi-Fi and Indah Water bills go in from one screen.
 *  Account kind -> expense category: electricity, water, internet, sewerage (Indah Water). Gas is not a statement row. */
const KINDS = ['electricity', 'water', 'internet', 'sewerage'];
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/** GET /api/expenses/utilities?month=YYYY-MM[&ownerId=|&unitId=] */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? '';
  if (!MONTH.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422);
  const ownerId = url.searchParams.get('ownerId'), unitId = url.searchParams.get('unitId');

  const rows = await all<any>(env, `
    SELECT a.id, a.unit_id, a.kind, a.account_no, a.provider, u.unit_number, p.name AS property_name, e.id AS expense_id, e.amount, e.charge_to, e.reference AS e_ref
    FROM unit_utility_accounts a JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (SELECT x.id, x.amount, x.charge_to, x.reference FROM expenses x WHERE x.unit_id = a.unit_id AND x.category = a.kind
                       AND (x.reference = a.account_no OR x.reference IS NULL OR x.reference = '')
                       AND x.incurred_on >= ? AND x.incurred_on < ? ORDER BY (x.reference = a.account_no) DESC NULLS LAST, x.created_at DESC LIMIT 1) e ON true
    WHERE a.kind IN ('electricity','water','internet','sewerage') ${ownerId ? 'AND u.owner_id = ?' : ''} ${unitId ? 'AND u.id = ?' : ''}
    ORDER BY p.name, u.unit_number, a.kind`,
    `${month}-01`, `${nextMonth(month)}-01`,
    ...(ownerId ? [ownerId] : []), ...(unitId ? [unitId] : []));
  return json({
    generatedAt: nowIso(), month,
    data: rows.map(r => ({
      accountId: r.id, unitId: r.unit_id, unitLabel: `${r.property_name} ${r.unit_number}`, kind: r.kind, kindLabel: KIND_LABEL[r.kind],
      accountNo: r.account_no, provider: r.provider, expenseId: r.expense_id, amount: r.amount == null ? null : Number(r.amount), chargeTo: r.charge_to ?? null,
      // A bill recorded some other way (the owner workbook import, the Expenses screen) is shown but not replaced here.
      recordedElsewhere: !!r.expense_id && r.e_ref !== r.account_no,
    })),
  });
};

/** POST /api/expenses/utilities { month, date?, rows: [{ accountId, amount (sen), chargeTo? }] }
 *  Records each bill as an expense on the account's unit, dated the given day (default the month's last day), with
 *  the account number as its reference. A bill already recorded for that account and month is replaced, not doubled.
 *  A row with no amount is skipped. Months whose owner statement is final are refused row by row. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<any>().catch(() => null);
  const month = String(b?.month ?? '');
  if (!MONTH.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422, { month: 'Pick a month.' });
  const last = new Date(Date.parse(`${nextMonth(month)}-01T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const date = typeof b.date === 'string' && b.date.startsWith(month) && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : last;
  const rows: { accountId: string; amount: number; chargeTo?: string }[] = Array.isArray(b.rows) ? b.rows : [];
  const bad = rows.find(r => r.amount != null && (!Number.isInteger(r.amount) || r.amount < 0));
  if (bad) return fail('VALIDATION', 'Amounts must be RM 0.00 or more.', 422, { [bad.accountId]: 'Check the amount.' });
  const wanted = rows.filter(r => r.amount != null && r.amount > 0);
  if (!wanted.length) return fail('VALIDATION', 'Enter at least one bill.', 422);
  if (wanted.some(r => r.chargeTo !== undefined && !CHARGE_TO.includes(r.chargeTo))) return fail('VALIDATION', 'Choose who pays each bill.', 422);

  const accounts = await all<any>(env, `
    SELECT a.id, a.unit_id, a.kind, a.account_no, a.provider FROM unit_utility_accounts a
    WHERE a.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(wanted.map(r => r.accountId)));
  const byId = new Map(accounts.map(a => [a.id, a]));
  const saved: string[] = [], locked: string[] = [], elsewhere: string[] = [], now = nowIso();
  for (const r of wanted) {
    const a = byId.get(r.accountId);
    if (!a || !KINDS.includes(a.kind)) continue;
    if (await isPeriodLocked(env, a.unit_id, date)) { locked.push(a.account_no); continue; }
    const other = await all(env, `SELECT 1 AS x FROM expenses WHERE unit_id = ? AND category = ? AND (reference IS NULL OR reference = '') AND incurred_on >= ? AND incurred_on < ? LIMIT 1`,
      a.unit_id, a.kind, `${month}-01`, `${nextMonth(month)}-01`);
    if (other.length) { elsewhere.push(a.account_no); continue; }
    await run(env, `DELETE FROM expenses WHERE unit_id = ? AND reference = ? AND category = ? AND incurred_on >= ? AND incurred_on < ?`,
      a.unit_id, a.account_no, a.kind, `${month}-01`, `${nextMonth(month)}-01`);
    const id = crypto.randomUUID();
    await run(env, `
      INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, reference, charge_to, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, ?, ?, ?)`,
      id, a.unit_id, a.kind, `${KIND_LABEL[a.kind]} ${month}${a.provider ? ` (${a.provider})` : ''}`, r.amount, date, a.account_no, r.chargeTo ?? 'owner', session.userId, now);
    saved.push(id);
  }
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utilities', entityTable: 'expenses', entityId: month, after: { month, saved: saved.length, locked: locked.length, recordedElsewhere: elsewhere.length } });
  return json({ saved: saved.length, locked, recordedElsewhere: elsewhere }, 201);
};
