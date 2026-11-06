import { type Env, all, run } from './db';

/** Utility bills and their payment requests (chew, 5 Nov 2026; SOP 3.10 "手动录入也一样", "Utility bills 两张表").
 *  The bills the company pays (not "Owner paid this bill") go to finance as one engine payment request per provider and
 *  save, from Scan bills and from the manual entry screens alike; each bill then keeps the request it went out on
 *  (expenses.payment_request_id / _no, migration 0219), so Utility bills can show it by request month and a bill already
 *  sent for payment is not replaced by a new entry. */

const KINDS = ['electricity', 'water', 'internet', 'sewerage'];
const KIND_LABEL: Record<string, string> = { electricity: 'Electricity', water: 'Water', internet: 'Internet', sewerage: 'Indah Water' };

export interface RequestBill { expenseId: string; unitId: string; kind: string; billMonth: string; accountNo: string | null; amountSen: number }

/** The bills among `expenseIds` still to be sent for payment, by provider: utility bills not paid by the owner, above
 *  zero and not on a request yet. The company pays the provider the whole bill: a scanned bill split at the contract
 *  start, or kept record only, goes at its full printed amount (utility_bill_scans.bill_sen), as Scan bills sends it.
 *  The provider is the scan's, else the bill's account's, else the kind ("Indah Water"); `provider` keeps one group. */
export async function billsToRequest(env: Env, expenseIds: string[], provider?: string): Promise<{ provider: string; bills: RequestBill[] }[]> {
  if (!expenseIds.length) return [];
  const rows = await all<{ id: string; unit_id: string; category: string; incurred_on: string; reference: string | null; amount: number; provider: string | null }>(env, `
    SELECT e.id, e.unit_id, e.category, e.incurred_on, e.reference, coalesce(s.bill_sen, e.amount) AS amount,
           coalesce(nullif(s.provider, ''), (SELECT a.provider FROM unit_utility_accounts a WHERE a.unit_id = e.unit_id AND a.kind = e.category AND a.account_no = e.reference
             AND coalesce(a.provider, '') <> '' ORDER BY a.created_at LIMIT 1)) AS provider
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id
    WHERE e.id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND e.category IN ('electricity','water','internet','sewerage')
      AND NOT e.owner_paid AND coalesce(s.bill_sen, e.amount) > 0 AND e.payment_request_id IS NULL
    ORDER BY e.incurred_on, e.unit_id, e.category`, JSON.stringify(expenseIds));
  const out = new Map<string, RequestBill[]>();
  for (const r of rows) {
    if (!KINDS.includes(r.category)) continue;
    const p = (r.provider ?? '').trim() || KIND_LABEL[r.category];
    if (provider && p !== provider) continue;
    const list = out.get(p) ?? [];
    list.push({ expenseId: r.id, unitId: r.unit_id, kind: r.category, billMonth: String(r.incurred_on).slice(0, 7), accountNo: r.reference || null, amountSen: Number(r.amount) });
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
export async function ownerPaidCredit(tx: Env, b: { expenseId: string; unitId: string; ownerId: string; kind: string; label: string; amountSen: number; deductMonth: string; accountNo: string | null },
  userId: string, now: string): Promise<void> {
  await run(tx, `INSERT INTO owner_adjustments (id, owner_id, unit_id, kind, amount, description, occurred_on, reference, state, source, expense_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'credit', ?, ?, ?, ?, 'open', 'manual', ?, ?, ?, ?)`,
    crypto.randomUUID(), b.ownerId, b.unitId, b.amountSen, `${b.label}, paid by the owner`, `${b.deductMonth}-01`, b.accountNo, b.expenseId, userId, now, now);
}
