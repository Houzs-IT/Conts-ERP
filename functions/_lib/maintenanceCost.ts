import { type Env, all, one, run, audit, nowIso } from './db';
import { isPeriodLocked } from './expenses';

/** What a maintenance job used and costs: items from the list and "Other" lines. Prices only for `money`. */
export interface IssueLine {
  id: string; skuId: string | null; code: string | null; description: string; kind: 'service' | 'part' | 'other'; uom: string;
  unitPrice: number | null; plannedQty: number; qty: number; amount: number | null; trackStock: boolean; stockOnHand: number | null;
}

export async function issueLines(env: Env, issueId: string, money: boolean): Promise<IssueLine[]> {
  const rows = await all<any>(env, `
    SELECT l.*, s.code, s.kind AS sku_kind, s.track_stock, s.stock_on_hand
    FROM maintenance_issue_lines l LEFT JOIN maintenance_skus s ON s.id = l.sku_id
    WHERE l.issue_id = ? ORDER BY l.sku_id IS NULL, l.created_at, l.id`, issueId);
  return rows.map(r => ({
    id: r.id, skuId: r.sku_id ?? null, code: r.code ?? null, description: r.description, kind: r.sku_id ? (r.sku_kind ?? 'service') : 'other', uom: r.uom,
    unitPrice: money ? Number(r.unit_price) : null, plannedQty: Number(r.planned_qty), qty: Number(r.qty),
    amount: money ? Number(r.unit_price) * Number(r.qty) : null,
    trackStock: !!r.track_stock, stockOnHand: r.track_stock ? Number(r.stock_on_hand) : null,
  }));
}

/** The job's cost from its lines, in sen. */
export async function linesTotal(env: Env, issueId: string): Promise<number> {
  const r = await one<{ n: number }>(env, 'SELECT COALESCE(SUM(qty * unit_price), 0)::int AS n FROM maintenance_issue_lines WHERE issue_id = ?', issueId);
  return Number(r?.n ?? 0);
}

/** Sets how many of a list item the job used. A stocked part moves the difference out of (or back into) the store,
 *  only if the store holds it. Returns 'short' with what is left when it does not. Runs on the env it is given
 *  (pass a transaction's). */
export async function setItemQty(env: Env, issueId: string, skuId: string, qty: number, actor: { id: string; label: string }):
  Promise<{ ok: true } | { ok: false; left: number } | { ok: false; missing: true }> {
  const sku = await one<{ id: string; name: string; track_stock: number; active: number; default_price: number; unit_label: string }>(env,
    'SELECT id, name, track_stock, active, default_price, unit_label FROM maintenance_skus WHERE id = ?', skuId);
  if (!sku) return { ok: false, missing: true };
  const cur = await one<{ id: string; qty: number }>(env, 'SELECT id, qty FROM maintenance_issue_lines WHERE issue_id = ? AND sku_id = ?', issueId, skuId);
  if (!cur && !sku.active) return { ok: false, missing: true };
  const before = Number(cur?.qty ?? 0);
  const delta = qty - before;
  const now = nowIso();
  if (sku.track_stock && delta !== 0) {
    const left = await one<{ stock_on_hand: number }>(env, `UPDATE maintenance_skus SET stock_on_hand = stock_on_hand - ?, updated_at = ? WHERE id = ? AND stock_on_hand >= ? RETURNING stock_on_hand`,
      delta, now, sku.id, Math.max(delta, 0));
    if (!left) {
      const s = await one<{ stock_on_hand: number }>(env, 'SELECT stock_on_hand FROM maintenance_skus WHERE id = ?', sku.id);
      return { ok: false, left: Number(s?.stock_on_hand ?? 0) };
    }
    await run(env, `INSERT INTO maintenance_stock_moves (id, sku_id, issue_id, qty, reason, moved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), sku.id, issueId, -delta, delta > 0 ? 'used' : 'returned', actor.id, now);
  }
  if (cur) await run(env, 'UPDATE maintenance_issue_lines SET qty = ?, updated_by = ?, updated_at = ? WHERE id = ?', qty, actor.id, now, cur.id);
  else {
    await run(env, `
      INSERT INTO maintenance_issue_lines (id, issue_id, sku_id, description, uom, unit_price, planned_qty, qty, created_by, created_at, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), issueId, sku.id, sku.name, sku.unit_label, sku.default_price, qty, actor.id, now, actor.id, now);
  }
  if (delta !== 0) await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'maintenance.item_qty', entityTable: 'maintenance_issues', entityId: issueId, before: { label: sku.name, quantity: before }, after: { label: sku.name, quantity: qty } });
  return { ok: true };
}

/** Posts the job's final cost to the unit as its one maintenance expense: adds it, moves it to the new amount, or takes
 *  it back at 0. Refused (null) when the month of the expense, or of today, is on a final owner statement. */
export async function postJobExpense(env: Env, job: { id: string; unit_id: string; title: string }, amount: number, chargeTo: string,
  actor: { id: string; label: string }): Promise<{ expenseId: string | null; amount: number } | 'locked'> {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const cur = await one<{ id: string; amount: number; incurred_on: string; charge_to: string }>(env,
    `SELECT id, amount, incurred_on, charge_to FROM expenses WHERE maintenance_id = ? AND category = 'maintenance' AND parent_expense_id IS NULL`, job.id);
  if (cur && Number(cur.amount) === amount && cur.charge_to === chargeTo) return { expenseId: cur.id, amount };
  if (!cur && amount === 0) return { expenseId: null, amount: 0 };
  if (cur && await isPeriodLocked(env, job.unit_id, cur.incurred_on)) return 'locked';
  if (!cur && await isPeriodLocked(env, job.unit_id, today)) return 'locked';
  const now = nowIso();
  if (cur && amount === 0) {
    await run(env, 'DELETE FROM expenses WHERE id = ?', cur.id);
    await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'expense.maintenance_reversed', entityTable: 'maintenance_issues', entityId: job.id, before: { expenseId: cur.id, amount: Number(cur.amount) }, after: { amount: 0 } });
    return { expenseId: null, amount: 0 };
  }
  if (cur) {
    await run(env, 'UPDATE expenses SET amount = ?, charge_to = ?, description = ? WHERE id = ?', amount, chargeTo, job.title, cur.id);
    await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'expense.maintenance_adjusted', entityTable: 'maintenance_issues', entityId: job.id, before: { expenseId: cur.id, amount: Number(cur.amount), chargeTo: cur.charge_to }, after: { expenseId: cur.id, amount, chargeTo } });
    return { expenseId: cur.id, amount };
  }
  const id = crypto.randomUUID();
  await run(env, `
    INSERT INTO expenses (id, unit_id, maintenance_id, category, description, amount, currency, incurred_on, charge_to, created_by, created_at)
    VALUES (?, ?, ?, 'maintenance', ?, ?, 'MYR', ?, ?, ?, ?)`,
    id, job.unit_id, job.id, job.title, amount, today, chargeTo, actor.id, now);
  await audit(env, { actorId: actor.id, actorLabel: actor.label, action: 'expense.maintenance_posted', entityTable: 'maintenance_issues', entityId: job.id, after: { expenseId: id, amount, chargeTo, incurredOn: today } });
  return { expenseId: id, amount };
}
