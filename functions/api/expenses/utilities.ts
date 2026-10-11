import { type Env, all, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { CHARGE_TO, lockedUnits } from '../../_lib/expenses';

/** Monthly utility bills by account number: one row per unit utility account (unit_utility_accounts), with what is
 *  already recorded for the month, so a month's TNB, water, Wi-Fi and Indah Water bills go in from one screen.
 *  Account kind -> expense category: electricity, water, internet, sewerage (Indah Water). Gas is not a statement row. */
const KINDS = ['electricity', 'water', 'internet', 'sewerage'];
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
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
  const from = `${month}-01`, to = `${nextMonth(month)}-01`;
  const picked = wanted.map(r => ({ r, a: byId.get(r.accountId) })).filter(x => x.a && KINDS.includes(x.a.kind));
  const unitIds = [...new Set(picked.map(x => x.a.unit_id as string))];
  // Read once what each row is checked against: final months, and bills recorded without an account number.
  const [lockedSet, blankRows] = await Promise.all([
    lockedUnits(env, unitIds, date),
    unitIds.length ? all<{ unit_id: string; category: string }>(env, `
      SELECT DISTINCT unit_id, category FROM expenses WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
        AND (reference IS NULL OR reference = '') AND incurred_on >= ? AND incurred_on < ?`, JSON.stringify(unitIds), from, to) : Promise.resolve([]),
  ]);
  const blank = new Set(blankRows.map(x => `${x.unit_id}|${x.category}`));
  const saved: string[] = [], locked: string[] = [], elsewhere: string[] = [], now = nowIso();
  // One bill per unit, kind and account number: a later row for the same account replaces an earlier one, as before.
  const bills = new Map<string, { id: string; unit_id: string; kind: string; description: string; amount: number; account_no: string; charge_to: string }>();
  for (const { r, a } of picked) {
    if (lockedSet.has(a.unit_id)) { locked.push(a.account_no); continue; }
    if (blank.has(`${a.unit_id}|${a.kind}`)) { elsewhere.push(a.account_no); continue; }
    const id = crypto.randomUUID();
    bills.set(`${a.unit_id}|${a.kind}|${a.account_no}`, {
      id, unit_id: a.unit_id, kind: a.kind, description: `${KIND_LABEL[a.kind]} ${monthName(month)}${a.provider ? ` (${a.provider})` : ''}`,
      amount: r.amount, account_no: a.account_no, charge_to: r.chargeTo ?? 'owner',
    });
    if (a.account_no === '') blank.add(`${a.unit_id}|${a.kind}`); // an empty account number reads as recorded elsewhere next time
    saved.push(id);
  }
  const rowsOut = [...bills.values()];
  await transaction(env, async tx => {
    if (rowsOut.length) {
      await run(tx, `DELETE FROM expenses e USING jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, kind text, account_no text)
        WHERE e.unit_id = x.unit_id AND e.reference = x.account_no AND e.category = x.kind AND e.incurred_on >= ? AND e.incurred_on < ?`,
        JSON.stringify(rowsOut.map(b => ({ unit_id: b.unit_id, kind: b.kind, account_no: b.account_no }))), from, to);
      await run(tx, `
        INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, reference, charge_to, created_by, created_at)
        SELECT x.id, x.unit_id, x.kind, x.description, x.amount, 'MYR', ?, x.account_no, x.charge_to, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, kind text, description text, amount bigint, account_no text, charge_to text)`,
        date, session.userId, now, JSON.stringify(rowsOut));
    }
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utilities', entityTable: 'expenses', entityId: month, after: { month, saved: saved.length, locked: locked.length, recordedElsewhere: elsewhere.length } });
  });
  return json({ saved: saved.length, locked, recordedElsewhere: elsewhere }, 201);
};
