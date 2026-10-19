import { type Env, all, run, json, fail, audit, nowIso, transaction } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { CHARGE_TO, lockedUnits } from '../../_lib/expenses';
import { receiptRequired, RECEIPT_REQUIRED } from '../../../src/lib/receipts';

/** Monthly utility bills by account number: one row per unit utility account (unit_utility_accounts), with what is
 *  already recorded for the month, so a month's TNB, water, Wi-Fi and Indah Water bills go in from one screen.
 *  Account kind -> expense category: electricity, water, internet, sewerage (Indah Water). Gas is not a statement row. */
const KINDS = ['electricity', 'water', 'internet', 'sewerage'];
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };

/** GET /api/expenses/utilities?month=YYYY-MM[&ownerId=|&unitId=]
 *  Also lists the units in scope with no account number on file at all, so the screen can offer to add one. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? '';
  if (!MONTH.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422);
  const ownerId = url.searchParams.get('ownerId'), unitId = url.searchParams.get('unitId');

  const rows = await all<any>(env, `
    SELECT a.id, a.unit_id, a.kind, a.account_no, a.provider, u.unit_number, p.name AS property_name, e.id AS expense_id, e.amount, e.charge_to, e.reference AS e_ref, e.receipt_document_id
    FROM unit_utility_accounts a JOIN units u ON u.id = a.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (SELECT x.id, x.amount, x.charge_to, x.reference, x.receipt_document_id FROM expenses x WHERE x.unit_id = a.unit_id AND x.category = a.kind
                       AND (x.reference = a.account_no OR x.reference IS NULL OR x.reference = '')
                       AND x.incurred_on >= ? AND x.incurred_on < ? ORDER BY (x.reference = a.account_no) DESC NULLS LAST, x.created_at DESC LIMIT 1) e ON true
    WHERE a.kind IN ('electricity','water','internet','sewerage') ${ownerId ? 'AND u.owner_id = ?' : ''} ${unitId ? 'AND u.id = ?' : ''}
    ORDER BY p.name, u.unit_number, a.kind`,
    `${month}-01`, `${nextMonth(month)}-01`,
    ...(ownerId ? [ownerId] : []), ...(unitId ? [unitId] : []));
  const bare = await all<any>(env, `
    SELECT u.id, u.unit_number, p.name AS property_name FROM units u JOIN properties p ON p.id = u.property_id
    WHERE u.parent_unit_id IS NULL ${ownerId ? 'AND u.owner_id = ?' : ''} ${unitId ? 'AND u.id = ?' : ''}
      AND NOT EXISTS (SELECT 1 FROM unit_utility_accounts a WHERE a.unit_id = u.id AND a.kind IN ('electricity','water','internet','sewerage'))
    ORDER BY p.name, u.unit_number`,
    ...(ownerId ? [ownerId] : []), ...(unitId ? [unitId] : []));
  // What those units already have for the month, so a bill is not entered twice.
  const bareBills = bare.length ? await all<{ unit_id: string; category: string; amount: number }>(env, `
    SELECT unit_id, category, amount FROM expenses WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
      AND category IN ('electricity','water','internet','sewerage') AND incurred_on >= ? AND incurred_on < ?
    ORDER BY created_at`, JSON.stringify(bare.map(u => u.id)), `${month}-01`, `${nextMonth(month)}-01`) : [];
  return json({
    generatedAt: nowIso(), month,
    unitsWithoutAccount: bare.map(u => ({
      unitId: u.id, unitLabel: `${u.property_name} ${u.unit_number}`,
      recorded: bareBills.filter(x => x.unit_id === u.id).map(x => ({ kind: x.category, kindLabel: KIND_LABEL[x.category], amount: Number(x.amount) })),
    })),
    data: rows.map(r => ({
      accountId: r.id, unitId: r.unit_id, unitLabel: `${r.property_name} ${r.unit_number}`, kind: r.kind, kindLabel: KIND_LABEL[r.kind],
      accountNo: r.account_no, provider: r.provider, expenseId: r.expense_id, amount: r.amount == null ? null : Number(r.amount), chargeTo: r.charge_to ?? null,
      receiptDocumentId: r.receipt_document_id ?? null,
      // A bill recorded some other way (the owner workbook import, Accounts payable) is shown but not replaced here.
      recordedElsewhere: !!r.expense_id && r.e_ref !== r.account_no,
    })),
  });
};

/** POST /api/expenses/utilities { month, date?, rows: [{ accountId, amount (sen), chargeTo?, receiptDocumentId? }] }
 *  A unit with no account number on file sends { unitId, kind } instead of accountId: its bill is recorded with no
 *  reference, once per unit, kind and month (a second one for the same month is refused as already recorded).
 *  Records each bill as an expense on the account's unit, dated the given day (default the month's last day), with
 *  the account number as its reference. A bill already recorded for that account and month is replaced, not doubled.
 *  A row with no amount is skipped. Months whose owner statement is final are refused row by row. A bill the owner
 *  pays needs its receipt: a new one, or the one already on the bill it replaces; without it nothing is saved. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const b = await request.json<any>().catch(() => null);
  const month = String(b?.month ?? '');
  if (!MONTH.test(month)) return fail('VALIDATION', 'Month must look like 2026-09.', 422, { month: 'Pick a month.' });
  const last = new Date(Date.parse(`${nextMonth(month)}-01T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const date = typeof b.date === 'string' && b.date.startsWith(month) && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : last;
  const rows: { accountId?: string; unitId?: string; kind?: string; amount: number; chargeTo?: string; receiptDocumentId?: string | null }[] = Array.isArray(b.rows) ? b.rows : [];
  const keyOf = (r: { accountId?: string; unitId?: string; kind?: string }) => r.accountId ?? `${r.unitId}:${r.kind}`;
  const bad = rows.find(r => r.amount != null && (!Number.isInteger(r.amount) || r.amount < 0));
  if (bad) return fail('VALIDATION', 'Amounts must be RM 0.00 or more.', 422, { [keyOf(bad)]: 'Check the amount.' });
  const entered = rows.filter(r => r.amount != null && r.amount > 0);
  if (entered.some(r => !r.accountId && (typeof r.unitId !== 'string' || !KINDS.includes(String(r.kind))))) return fail('VALIDATION', 'Pick the bill for each unit.', 422);
  const wanted = entered.filter(r => r.accountId);
  const loose = entered.filter(r => !r.accountId) as { unitId: string; kind: string; amount: number; chargeTo?: string; receiptDocumentId?: string | null }[];
  if (!entered.length) return fail('VALIDATION', 'Enter at least one bill.', 422);
  if (entered.some(r => r.chargeTo !== undefined && !CHARGE_TO.includes(r.chargeTo))) return fail('VALIDATION', 'Choose who pays each bill.', 422);

  const accounts = await all<any>(env, `
    SELECT a.id, a.unit_id, a.kind, a.account_no, a.provider FROM unit_utility_accounts a
    WHERE a.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(wanted.map(r => r.accountId)));
  const byId = new Map(accounts.map(a => [a.id, a]));
  const from = `${month}-01`, to = `${nextMonth(month)}-01`;
  const picked = wanted.map(r => ({ r, a: byId.get(r.accountId!) })).filter(x => x.a && KINDS.includes(x.a.kind));
  // A unit-only bill is for a unit that exists and has no account of that kind (one with an account uses its line).
  const looseUnits = loose.length ? await all<{ id: string; has: boolean; kind: string }>(env, `
    SELECT u.id, x.kind, EXISTS (SELECT 1 FROM unit_utility_accounts a WHERE a.unit_id = u.id AND a.kind = x.kind) AS has
    FROM jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, kind text) JOIN units u ON u.id = x.unit_id`,
    JSON.stringify(loose.map(r => ({ unit_id: r.unitId, kind: r.kind })))) : [];
  const looseOk = new Set(looseUnits.filter(x => !x.has).map(x => `${x.id}:${x.kind}`));
  const unitBills = loose.filter(r => looseOk.has(`${r.unitId}:${r.kind}`));
  const unitIds = [...new Set([...picked.map(x => x.a.unit_id as string), ...unitBills.map(r => r.unitId)])];
  const given = [...new Set([...picked.map(x => x.r.receiptDocumentId), ...unitBills.map(r => r.receiptDocumentId)].filter((x): x is string => typeof x === 'string' && !!x))];
  // Read once what each row is checked against: final months, bills recorded without an account number, receipts,
  // and for unit-only bills any bill of that kind already in the month.
  const [lockedSet, blankRows, onFile, known, anyRows] = await Promise.all([
    lockedUnits(env, unitIds, date),
    unitIds.length ? all<{ unit_id: string; category: string }>(env, `
      SELECT DISTINCT unit_id, category FROM expenses WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
        AND (reference IS NULL OR reference = '') AND incurred_on >= ? AND incurred_on < ?`, JSON.stringify(unitIds), from, to) : Promise.resolve([]),
    // The receipt already on a bill this save replaces is kept unless a new one is given.
    unitIds.length ? all<{ unit_id: string; category: string; reference: string; receipt_document_id: string }>(env, `
      SELECT unit_id, category, reference, receipt_document_id FROM expenses WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
        AND receipt_document_id IS NOT NULL AND incurred_on >= ? AND incurred_on < ?`, JSON.stringify(unitIds), from, to) : Promise.resolve([]),
    given.length ? all<{ id: string }>(env, `SELECT id FROM documents WHERE kind = 'receipt' AND id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(given)) : Promise.resolve([]),
    unitBills.length ? all<{ unit_id: string; category: string }>(env, `
      SELECT DISTINCT unit_id, category FROM expenses WHERE unit_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))
        AND incurred_on >= ? AND incurred_on < ?`, JSON.stringify(unitBills.map(r => r.unitId)), from, to) : Promise.resolve([]),
  ]);
  const keptReceipt = new Map(onFile.map(x => [`${x.unit_id}|${x.category}|${x.reference}`, x.receipt_document_id]));
  const knownReceipts = new Set(known.map(x => x.id));
  if (given.some(id => !knownReceipts.has(id))) return fail('VALIDATION', 'A receipt was not found. Upload it again.', 422);

  const blank = new Set(blankRows.map(x => `${x.unit_id}|${x.category}`));
  const saved: string[] = [], locked: string[] = [], elsewhere: string[] = [], now = nowIso();
  // One bill per unit, kind and account number: a later row for the same account replaces an earlier one, as before.
  const bills = new Map<string, { id: string; unit_id: string; kind: string; description: string; amount: number; account_no: string; charge_to: string; receipt: string | null; accountId: string }>();
  for (const { r, a } of picked) {
    if (lockedSet.has(a.unit_id)) { locked.push(a.account_no); continue; }
    if (blank.has(`${a.unit_id}|${a.kind}`)) { elsewhere.push(a.account_no); continue; }
    const id = crypto.randomUUID();
    bills.set(`${a.unit_id}|${a.kind}|${a.account_no}`, {
      id, unit_id: a.unit_id, kind: a.kind, description: `${KIND_LABEL[a.kind]} ${monthName(month)}${a.provider ? ` (${a.provider})` : ''}`,
      amount: r.amount, account_no: a.account_no, charge_to: r.chargeTo ?? 'owner',
      receipt: r.receiptDocumentId || keptReceipt.get(`${a.unit_id}|${a.kind}|${a.account_no}`) || null, accountId: a.id,
    });
    if (a.account_no === '') blank.add(`${a.unit_id}|${a.kind}`); // an empty account number reads as recorded elsewhere next time
    saved.push(id);
  }
  const already = new Set(anyRows.map(x => `${x.unit_id}:${x.category}`));
  const unitOut = new Map<string, { id: string; unit_id: string; kind: string; description: string; amount: number; charge_to: string; receipt: string | null; accountId: string }>();
  for (const r of unitBills) {
    const key = `${r.unitId}:${r.kind}`;
    if (lockedSet.has(r.unitId)) { locked.push(key); continue; }
    if (already.has(key)) { elsewhere.push(key); continue; }
    if (!unitOut.has(key)) saved.push(key);
    unitOut.set(key, { id: crypto.randomUUID(), unit_id: r.unitId, kind: r.kind, description: `${KIND_LABEL[r.kind]} ${monthName(month)}`,
      amount: r.amount, charge_to: r.chargeTo ?? 'owner', receipt: r.receiptDocumentId || null, accountId: key });
  }
  const rowsOut = [...bills.values()];
  const looseOut = [...unitOut.values()];
  const missing = Object.fromEntries([...rowsOut, ...looseOut].filter(x => receiptRequired(x.kind, x.charge_to) && !x.receipt).map(x => [x.accountId, RECEIPT_REQUIRED]));
  const nMissing = Object.keys(missing).length;
  if (nMissing) return fail('RECEIPT_REQUIRED', `${nMissing === 1 ? 'A bill the owner pays has' : `${nMissing} bills the owner pays have`} no receipt. Attach each one and save again.`, 422, missing);
  await transaction(env, async tx => {
    if (rowsOut.length) {
      await run(tx, `DELETE FROM expenses e USING jsonb_to_recordset(?::text::jsonb) AS x(unit_id text, kind text, account_no text)
        WHERE e.unit_id = x.unit_id AND e.reference = x.account_no AND e.category = x.kind AND e.incurred_on >= ? AND e.incurred_on < ?`,
        JSON.stringify(rowsOut.map(b => ({ unit_id: b.unit_id, kind: b.kind, account_no: b.account_no }))), from, to);
      await run(tx, `
        INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, reference, charge_to, receipt_document_id, created_by, created_at)
        SELECT x.id, x.unit_id, x.kind, x.description, x.amount, 'MYR', ?, x.account_no, x.charge_to, x.receipt, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, kind text, description text, amount bigint, account_no text, charge_to text, receipt text)`,
        date, session.userId, now, JSON.stringify(rowsOut));
    }
    if (looseOut.length) {
      await run(tx, `
        INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, reference, charge_to, receipt_document_id, created_by, created_at)
        SELECT x.id, x.unit_id, x.kind, x.description, x.amount, 'MYR', ?, NULL, x.charge_to, x.receipt, ?, ?
        FROM jsonb_to_recordset(?::text::jsonb) AS x(id text, unit_id text, kind text, description text, amount bigint, charge_to text, receipt text)`,
        date, session.userId, now, JSON.stringify(looseOut));
    }
    await audit(tx, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utilities', entityTable: 'expenses', entityId: month, after: { month, saved: saved.length, locked: locked.length, recordedElsewhere: elsewhere.length } });
  });
  return json({ saved: saved.length, locked, recordedElsewhere: elsewhere }, 201);
};
