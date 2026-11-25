import { type Env, all, one, run, json, fail, audit, nowIso, transaction } from '../../../../../_lib/db';
import { requireSession } from '../../../../../_lib/auth';
import { rmText } from '../../../../../_lib/format';
import { CHARGE_TO, isExpenseLocked, isUtility, utilityDeduction } from '../../../../../_lib/expenses';
import { ownerPaidCredit, requestState, RETURNED } from '../../../../../_lib/utilityRequests';
import { keptCostProblem, unitLabel } from '../../../../../_lib/lockGuards';

const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10); };
const NOTE = /, RM [\d,]+\.\d{2} of a RM [\d,]+\.\d{2} bill shared with .*$/;

type Cur = { id: string; unit_id: string; category: string; reference: string | null; amount: number; incurred_on: string; deduct_month: string; description: string | null;
  owner_paid: boolean; record_only: boolean; payment_request_id: string | null; payment_request_no: string | null; receipt_document_id: string | null; split_of: string | null;
  scan_id: string | null; bill_sen: number | null; parts: number };

async function load(env: Env, id: string): Promise<Cur | null> {
  return one<Cur>(env, `
    SELECT e.id, e.unit_id, e.category, e.reference, e.amount, left(e.incurred_on::text, 10) AS incurred_on, e.deduct_month, e.description,
           coalesce(e.owner_paid, false) AS owner_paid, coalesce(e.record_only, false) AS record_only, e.payment_request_id, e.payment_request_no,
           e.receipt_document_id, e.split_of, s.id AS scan_id, s.bill_sen,
           (SELECT count(*)::int FROM expenses x WHERE x.split_of = e.id) AS parts
    FROM expenses e LEFT JOIN utility_bill_scans s ON s.expense_id = e.id WHERE e.id = ?`, id);
}

/** What stops a bill being split or put back: a final statement, a cost lock, or a payment request finance is on. A request
 *  that came back (withdrawn or rejected) is fine: the bill changes here and goes with Send again. */
async function blocked(env: Env, cur: Cur): Promise<string | null> {
  if (await isExpenseLocked(env, cur)) return 'The owner statement for this bill is final, so it cannot be split.';
  const kept = await keptCostProblem(env, cur.id);
  if (kept) return kept;
  if (cur.payment_request_id) {
    const state = await requestState(env, cur.payment_request_id);
    if (state && !RETURNED.has(state.status)) return `${state.requestNo ?? 'Its payment request'} is with finance. Split it before it is sent, or after finance sends it back.`;
  }
  return null;
}

/** POST /api/expenses/utilities/bills/:id/split { shares: [{ unitId, amountSen, chargeTo?, ownerPaid? }] }
 *  One utility bill that is really for two or more units (chew, 25 Nov 2026: "Utility bills 手动输入也要可以分"), split
 *  after it is recorded, on Utility bills as on Scan bills: each share is a bill of its own on its unit, its amount typed,
 *  deducted from that unit's owner or not (chargeTo) and paid back to that owner or not (ownerPaid, an O2 credit); this
 *  bill keeps the rest. The page stays the same, the provider is paid once for the parts no owner paid (utilityRequests).
 *  Refused on a bill already split or that is a part, a record-only bill, one its owner paid, a final or locked month, a
 *  request finance is on, a share as much as the shared part, a unit twice, or a unit that has this bill already.
 *  DELETE puts the parts back on the bill (to fix a split), while their owner lines are open.
 *  Finance and management only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const b = await request.json<{ shares?: { unitId?: unknown; amountSen?: unknown; chargeTo?: unknown; ownerPaid?: unknown }[] }>().catch(() => null);
  const shares = (Array.isArray(b?.shares) ? b!.shares : []).map(x => ({
    unitId: typeof x?.unitId === 'string' ? x.unitId : '', amountSen: Number(x?.amountSen),
    chargeTo: typeof x?.chargeTo === 'string' ? x.chargeTo : 'owner', ownerPaid: x?.ownerPaid === true,
  }));
  if (!shares.length) return fail('VALIDATION', 'Add the other unit and its amount.', 422);
  if (shares.length > 10) return fail('VALIDATION', 'Split a bill into up to 11 units.', 422);
  if (shares.some(x => !x.unitId)) return fail('VALIDATION', 'Pick the unit of each part.', 422);
  if (shares.some(x => !Number.isInteger(x.amountSen) || x.amountSen <= 0)) return fail('VALIDATION', 'Enter the amount of each part.', 422);
  if (shares.some(x => !CHARGE_TO.includes(x.chargeTo))) return fail('VALIDATION', 'Choose who pays each part.', 422);

  const cur = await load(env, id);
  if (!cur || !isUtility(cur.category)) return fail('NOT_FOUND', 'That utility bill no longer exists.', 404);
  if (cur.split_of) return fail('VALIDATION', 'This is already a part of a split bill. Split the bill it came from.', 422);
  if (cur.parts) return fail('VALIDATION', 'This bill is split already. Undo the split first to change it.', 422);
  if (cur.record_only) return fail('VALIDATION', 'A bill kept for the records only is not split.', 422);
  if (cur.owner_paid) return fail('VALIDATION', 'A bill its owner paid is not split. Change who paid it first.', 422);
  const units = [cur.unit_id, ...shares.map(x => x.unitId)];
  if (new Set(units).size !== units.length) return fail('VALIDATION', 'A unit is in the split twice.', 422);
  const shared = shares.reduce((n, x) => n + x.amountSen, 0);
  if (shared >= Number(cur.amount)) return fail('VALIDATION', `The parts come to ${rmText(shared)}; this bill's shared part is ${rmText(Number(cur.amount))}. Leave some for this unit.`, 422);
  const stop = await blocked(env, cur);
  if (stop) return fail('LOCKED', stop, 409);

  const owners = new Map((await all<{ id: string; owner_id: string | null }>(env, `SELECT id, owner_id FROM units WHERE id IN (SELECT jsonb_array_elements_text(?::text::jsonb))`,
    JSON.stringify(shares.map(x => x.unitId)))).map(u => [u.id, u.owner_id]));
  const lost = shares.find(x => !owners.has(x.unitId));
  if (lost) return fail('VALIDATION', 'A unit was not found.', 422);
  const noOwner = shares.find(x => x.ownerPaid && !owners.get(x.unitId));
  if (noOwner) return fail('VALIDATION', `${await unitLabel(env, noOwner.unitId)} has no owner to pay back.`, 422);
  const month = cur.incurred_on.slice(0, 7);
  for (const x of shares) {
    const there = await one(env, `SELECT 1 AS x FROM expenses WHERE unit_id = ? AND category = ? AND coalesce(reference, '') = coalesce(?, '') AND incurred_on >= ? AND incurred_on <= ? LIMIT 1`,
      x.unitId, cur.category, cur.reference, `${month}-01`, lastDay(month));
    if (there) return fail('ALREADY_RECORDED', `${await unitLabel(env, x.unitId)} already has this bill for that month.`, 409);
  }

  const whole = Number(cur.amount) + shared;
  const labels = new Map(await Promise.all(units.map(async u => [u, await unitLabel(env, u)] as const)));
  const note = (unitId: string, sen: number) => `, ${rmText(sen)} of a ${rmText(whole)} bill shared with ${units.filter(u => u !== unitId).map(u => labels.get(u)).join(', ')}`;
  const base = (cur.description ?? 'Utility bill').replace(NOTE, '');
  const at = nowIso();
  const deductions = await Promise.all(shares.map(x => utilityDeduction(env, x.unitId, cur.incurred_on)));
  const made: string[] = [];
  await transaction(env, async tx => {
    for (const [i, x] of shares.entries()) {
      const partId = crypto.randomUUID();
      made.push(partId);
      const d = deductions[i]!;
      await run(tx, `INSERT INTO expenses (id, unit_id, category, description, amount, currency, incurred_on, deduct_month, rolled, record_only, reference, charge_to,
          receipt_document_id, created_by, created_at, owner_paid, split_of, payment_request_id, payment_request_no)
        VALUES (?, ?, ?, ?, ?, 'MYR', ?, ?, ?, false, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        partId, x.unitId, cur.category, base + note(x.unitId, x.amountSen), x.amountSen, cur.incurred_on, d.deductMonth, d.rolled, cur.reference, x.chargeTo,
        cur.receipt_document_id, session.userId, at, x.ownerPaid, cur.id, cur.payment_request_id, cur.payment_request_no);
      if (x.ownerPaid) {
        await ownerPaidCredit(tx, { expenseId: partId, unitId: x.unitId, ownerId: owners.get(x.unitId)!, kind: cur.category, label: base + note(x.unitId, x.amountSen),
          amountSen: x.amountSen, deductMonth: d.deductMonth, accountNo: cur.reference }, session.userId, at);
      }
    }
    await run(tx, 'UPDATE expenses SET amount = ?, description = ? WHERE id = ?', Number(cur.amount) - shared, base + note(cur.unit_id, Number(cur.amount) - shared), cur.id);
    if (cur.scan_id) {
      await run(tx, 'UPDATE utility_bill_scans SET payable_sen = ? WHERE id = ?',
        Number(cur.bill_sen ?? whole) - shares.filter(x => x.ownerPaid).reduce((n, x) => n + x.amountSen, 0), cur.scan_id);
    }
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_bill_split', entityTable: 'expenses', entityId: cur.id,
    before: { amount: Number(cur.amount) }, after: { amount: Number(cur.amount) - shared, parts: shares.map((x, i) => ({ id: made[i], ...x })) } });
  return json({ ok: true, kept: Number(cur.amount) - shared, parts: made.length, rolled: deductions.some(d => d.rolled) }, 201);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!session.manage) return fail('FORBIDDEN', 'Utility bills are entered by finance and management.', 403);
  const id = String(params.id ?? '');
  const cur = await load(env, id);
  if (!cur || !isUtility(cur.category)) return fail('NOT_FOUND', 'That utility bill no longer exists.', 404);
  if (!cur.parts) return fail('VALIDATION', 'This bill is not split.', 422);
  const stop = await blocked(env, cur);
  if (stop) return fail('LOCKED', stop, 409);
  const parts = await all<{ id: string; unit_id: string; amount: number; deduct_month: string }>(env, 'SELECT id, unit_id, amount, deduct_month FROM expenses WHERE split_of = ?', id);
  for (const p of parts) {
    if (await isExpenseLocked(env, p)) return fail('LOCKED', `${await unitLabel(env, p.unit_id)}'s part is on a final statement, so the split stays.`, 409);
    const kept = await keptCostProblem(env, p.id);
    if (kept) return fail('LOCKED', kept, 409);
  }
  const frozen = await one(env, `SELECT 1 AS x FROM owner_adjustments a LEFT JOIN owner_statements s ON s.id = a.statement_id
    WHERE a.expense_id IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND (a.state <> 'open' OR (s.id IS NOT NULL AND s.state <> 'provisional')
      OR EXISTS (SELECT 1 FROM owner_report_locks k WHERE k.stage = 'o2' AND k.frozen->'adjustments' @> jsonb_build_array(jsonb_build_object('id', a.id)))) LIMIT 1`,
    JSON.stringify(parts.map(p => p.id)));
  if (frozen) return fail('LOCKED', 'An owner line of a part is on a closed owner statement, so the split stays.', 409);
  const back = parts.reduce((n, p) => n + Number(p.amount), 0);
  await transaction(env, async tx => {
    await run(tx, 'DELETE FROM owner_adjustments WHERE expense_id IN (SELECT jsonb_array_elements_text(?::text::jsonb))', JSON.stringify(parts.map(p => p.id)));
    await run(tx, 'DELETE FROM expenses WHERE split_of = ?', id);
    await run(tx, 'UPDATE expenses SET amount = ?, description = ? WHERE id = ?', Number(cur.amount) + back, (cur.description ?? 'Utility bill').replace(NOTE, ''), id);
    if (cur.scan_id) await run(tx, 'UPDATE utility_bill_scans SET payable_sen = NULL WHERE id = ?', cur.scan_id);
  });
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'expense.utility_bill_unsplit', entityTable: 'expenses', entityId: id,
    before: { amount: Number(cur.amount), parts: parts.length }, after: { amount: Number(cur.amount) + back } });
  return json({ ok: true, amount: Number(cur.amount) + back });
};
