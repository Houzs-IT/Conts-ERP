import { type Env, all, one, run } from './db';
import { o2Date } from './lockGuards';

/** Utility bills and their payment requests (chew, 5 Nov 2026; SOP 3.10 "手动录入也一样", "Utility bills 两张表").
 *  The bills the company pays (not "Owner paid this bill") go to finance as one engine payment request per provider and
 *  save, from Scan bills and from the manual entry screens alike; each bill then keeps the request it went out on
 *  (expenses.payment_request_id / _no, migration 0219), so Utility bills can show it by request month and a bill already
 *  sent for payment is not replaced by a new entry. */

const KINDS = ['electricity', 'water', 'internet', 'sewerage'];
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };

/** billDate: the day the bill's expense belongs to: the end of its printed period, else its bill date as entered (chew,
 *  16 Nov 2026: the engine books the expense against the accrual on it when the bill is paid). */
export interface RequestBill { expenseId: string; unitId: string; kind: string; billMonth: string; billDate: string | null; dueDate: string | null; accountNo: string | null; amountSen: number }

/** The bills among `expenseIds` still to be sent for payment, by provider: utility bills not paid by the owner, above
 *  zero and not on a request yet. The company pays the provider the whole bill: a scanned bill split at the contract
 *  start, or kept record only, goes at its full printed amount (utility_bill_scans.bill_sen), as Scan bills sends it.
 *  The provider is the scan's, else the bill's account's, else the kind ("Indah Water"); `provider` keeps one group. */
export async function billsToRequest(env: Env, expenseIds: string[], provider?: string): Promise<{ provider: string; bills: RequestBill[] }[]> {
  if (!expenseIds.length) return [];
  const rows = await all<{ id: string; unit_id: string; category: string; incurred_on: string; bill_date: string | null; due_date: string | null; reference: string | null; amount: number; provider: string | null }>(env, `
    SELECT e.id, e.unit_id, e.category, e.incurred_on, left(coalesce(e.period_to::text, e.incurred_on::text), 10) AS bill_date, left(s.due_date::text, 10) AS due_date, e.reference, coalesce(s.bill_sen, e.amount + coalesce((SELECT -sum(o.amount) FROM owner_adjustments o WHERE o.expense_id = e.id AND o.kind = 'charge'), 0)) AS amount,
           coalesce(nullif(s.provider, ''), (SELECT a.provider FROM unit_utility_accounts a WHERE a.unit_id = e.unit_id AND a.kind = e.category AND a.account_no = e.reference
             AND coalesce(a.provider, '') <> '' ORDER BY a.created_at LIMIT 1)) AS provider
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id
    WHERE e.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND e.category IN ('electricity','water','internet','sewerage')
      AND NOT e.owner_paid AND coalesce(s.bill_sen, e.amount + coalesce((SELECT -sum(o.amount) FROM owner_adjustments o WHERE o.expense_id = e.id AND o.kind = 'charge'), 0)) > 0 AND e.payment_request_id IS NULL
    ORDER BY e.incurred_on, e.unit_id, e.category`, JSON.stringify(expenseIds));
  const out = new Map<string, RequestBill[]>();
  for (const r of rows) {
    if (!KINDS.includes(r.category)) continue;
    const p = (r.provider ?? '').trim() || KIND_LABEL[r.category];
    if (provider && p !== provider) continue;
    const list = out.get(p) ?? [];
    list.push({ expenseId: r.id, unitId: r.unit_id, kind: r.category, billMonth: String(r.incurred_on).slice(0, 7), billDate: r.bill_date ?? null, dueDate: r.due_date ?? null, accountNo: r.reference || null, amountSen: Number(r.amount) });
    out.set(p, list);
  }
  return [...out].map(([p, bills]) => ({ provider: p, bills }));
}

/** The same save sent twice names the same request: the key is the provider's bills, not the moment. */
export async function requestKey(expenseIds: string[]): Promise<string> {
  const text = [...expenseIds].sort().join(',');
  const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `bills-${hex.slice(0, 24)}`;
}

/** A request finance sent back, or its sender withdrew: its bills are fixed and it goes out again (chew, 13 Nov 2026). */
export const RETURNED = new Set(['WITHDRAWN', 'REJECTED']);

/** A request as the Utility bills screens may read it (migrations 0220, 0327: only requests a bill points at), with why
 *  it came back; null when no bill points at it. */
export async function requestState(env: Env, requestId: string): Promise<{ id: string; requestNo: string | null; status: string; reason: string | null; decidedBy: string | null } | null> {
  const r = await one<{ id: string; request_no: string | null; status: string; reason: string | null; decided_by: string | null }>(env,
    `SELECT id, request_no, status, reason, decided_by FROM utility_payment_requests() WHERE id = ?`, requestId);
  return r ? { id: r.id, requestNo: r.request_no, status: r.status, reason: r.reason, decidedBy: r.decided_by } : null;
}

/** The bills still on a request that came back, to send it again with them as they are now: those the company pays, at
 *  their full bills as billsToRequest sends them. `off` names the ones the owner now pays (or at nothing), which are let
 *  go of the request once it has gone out again. */
export async function billsOnRequest(env: Env, requestId: string): Promise<{ bills: RequestBill[]; off: string[] }> {
  const rows = await all<{ id: string; unit_id: string; category: string; incurred_on: string; bill_date: string | null; due_date: string | null; reference: string | null; amount: number; owner_paid: boolean }>(env, `
    SELECT e.id, e.unit_id, e.category, e.incurred_on, left(coalesce(e.period_to::text, e.incurred_on::text), 10) AS bill_date, left(s.due_date::text, 10) AS due_date, e.reference, coalesce(s.bill_sen, e.amount + coalesce((SELECT -sum(o.amount) FROM owner_adjustments o WHERE o.expense_id = e.id AND o.kind = 'charge'), 0)) AS amount, e.owner_paid
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id
    WHERE e.payment_request_id = ? ORDER BY e.incurred_on, e.unit_id, e.category, e.id`, requestId);
  const bills: RequestBill[] = [], off: string[] = [];
  for (const r of rows) {
    if (r.owner_paid || !(Number(r.amount) > 0) || !KINDS.includes(r.category)) { off.push(r.id); continue; }
    bills.push({ expenseId: r.id, unitId: r.unit_id, kind: r.category, billMonth: String(r.incurred_on).slice(0, 7), billDate: r.bill_date ?? null, dueDate: r.due_date ?? null, accountNo: r.reference || null, amountSen: Number(r.amount) });
  }
  return { bills, off };
}

/** Bills let go of their request: they no longer go out on it. */
export async function unlinkRequest(env: Env, expenseIds: string[]): Promise<number> {
  if (!expenseIds.length) return 0;
  const rows = await all<{ id: string }>(env, `UPDATE expenses SET payment_request_id = NULL, payment_request_no = NULL
    WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) RETURNING id`, JSON.stringify(expenseIds));
  return rows.length;
}

/** Bills moved from one request to another, each to its own (an old grouped request split into one per bill); a bill
 *  no longer on `fromId` stays where it is. */
export async function moveRequest(env: Env, fromId: string, moves: { expenseId: string; id: string; requestNo: string | null }[]): Promise<number> {
  if (!moves.length) return 0;
  const rows = await all<{ id: string }>(env, `UPDATE expenses e SET payment_request_id = m.id, payment_request_no = m.no
    FROM jsonb_to_recordset(?::text::jsonb) AS m(expense_id text, id text, no text)
    WHERE e.id = m.expense_id AND e.payment_request_id = ? RETURNING e.id`,
    JSON.stringify(moves.map(m => ({ expense_id: m.expenseId, id: m.id, no: m.requestNo }))), fromId);
  return rows.length;
}

/** Each bill's provider as billsToRequest names it: the scan's, else its account's, else the kind. */
export async function providersOf(env: Env, expenseIds: string[]): Promise<Map<string, string>> {
  if (!expenseIds.length) return new Map();
  const rows = await all<{ id: string; category: string; provider: string | null }>(env, `
    SELECT e.id, e.category, coalesce(nullif(s.provider, ''), (SELECT a.provider FROM unit_utility_accounts a WHERE a.unit_id = e.unit_id AND a.kind = e.category
             AND a.account_no = e.reference AND coalesce(a.provider, '') <> '' ORDER BY a.created_at LIMIT 1)) AS provider
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id WHERE e.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(expenseIds));
  return new Map(rows.map(r => [r.id, (r.provider ?? '').trim() || KIND_LABEL[r.category] || 'Utility']));
}

/** Each bill's own page (its receipt document), as a file the engine keeps on the request; a bill with none is left out. */
export async function billPages(env: Env, expenseIds: string[]): Promise<Map<string, { name: string; mime: string; dataBase64: string }>> {
  if (!expenseIds.length || !env.MEDIA) return new Map();
  const docs = await all<{ id: string; storage_key: string; mime_type: string; file_name: string }>(env, `
    SELECT e.id, d.storage_key, d.mime_type, d.file_name FROM expenses e JOIN documents d ON d.id = e.receipt_document_id
    WHERE e.id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, JSON.stringify(expenseIds));
  const out = new Map<string, { name: string; mime: string; dataBase64: string }>();
  await Promise.all(docs.map(async d => {
    const obj = await env.MEDIA!.get(d.storage_key);
    if (!obj) return;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.set(d.id, { name: d.file_name.slice(0, 200), mime: d.mime_type, dataBase64: btoa(bin) });
  }));
  return out;
}

/** Each bill keeps the request it went out on; a bill already on one keeps that one. */
export async function linkRequest(env: Env, expenseIds: string[], request: { id: string; requestNo: string | null }): Promise<number> {
  if (!expenseIds.length || !request.id) return 0;
  const rows = await all<{ id: string }>(env, `UPDATE expenses SET payment_request_id = ?, payment_request_no = ?
    WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND payment_request_id IS NULL RETURNING id`,
    String(request.id), request.requestNo ?? null, JSON.stringify(expenseIds));
  return rows.length;
}

/** "Owner paid this bill" on a manual entry, as on Scan bills: the bill is shared as usual and the full amount goes back
 *  to the owner as an open O2 credit on the deduction month, on the unit's owner. `run` is the transaction's. */
/** The part of a shared bill the owner bears alone (chew, 19 Nov 2026): an O2 charge after the share, tied to the bill
 *  (expense_id), so replacing or removing the bill takes it along; the bill's expense is the rest, and the provider is
 *  still paid the whole bill (billsToRequest adds the charge back for a bill with no scan). */
export async function ownerOwnPart(tx: Env, b: { expenseId: string; unitId: string; ownerId: string; label: string; amountSen: number; deductMonth: string; accountNo: string | null },
  userId: string, now: string): Promise<void> {
  await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, expense_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'charge', ?, ?, ?, ?, 'open', 'manual', ?, ?, ?, ?)`,
    crypto.randomUUID(), b.ownerId, b.unitId, -b.amountSen, `${b.label}: the owner's own part`, (await o2Date(tx, b.ownerId, b.unitId, `${b.deductMonth}-01`)).occurredOn, b.accountNo, b.expenseId, userId, now, now);
}

export async function ownerPaidCredit(tx: Env, b: { expenseId: string; unitId: string; ownerId: string; kind: string; label: string; amountSen: number; deductMonth: string; accountNo: string | null },
  userId: string, now: string): Promise<void> {
  await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, expense_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, 'open', 'manual', ?, ?, ?, ?)`,
    crypto.randomUUID(), b.ownerId, b.unitId, b.amountSen, `${b.label}, paid by the owner`, (await o2Date(tx, b.ownerId, b.unitId, `${b.deductMonth}-01`)).occurredOn, b.accountNo, b.expenseId, userId, now, now);
}
