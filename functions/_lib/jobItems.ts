import { type Env, one, run, fail, nowIso, mytToday } from './db';
import { serviceBook } from './servicePrices';
import { layoutKey } from './cleaningPrices';

export interface Line { item_id: string | null; name: string; qty: number; owner_price: number; internal_cost: number | null }

/** A maintenance job's items as sent ([{ itemId, qty }] or Other: [{ itemId: null, name, qty, ownerPrice, internalCost? }]),
 *  priced from Service prices in force today at the unit's layout. Returns the lines or the failure to send back. */
export async function priceLines(env: Env, unitId: string, items: unknown): Promise<{ lines: Line[] } | { error: Response }> {
  if (!Array.isArray(items) || items.length > 50) return { error: fail('VALIDATION', 'Send the items.', 422, { items: 'Pick the items.' }) };
  const unit = await one<{ layout_type: string | null; bedrooms: number | null }>(env, 'SELECT * FROM units WHERE id = ?', unitId);
  const book = await serviceBook(env, [unitId]);
  const layout = layoutKey(unit?.layout_type, unit?.bedrooms), today = mytToday();
  const lines: Line[] = [];
  for (const [n, r] of (items as any[]).entries()) {
    const qty = Number(r?.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 10000 || Math.abs(Math.round(qty * 100) - qty * 100) > 1e-6) return { error: fail('VALIDATION', `Line ${n + 1}: the quantity is more than 0, up to two decimals.`, 422, { items: 'Check the quantities.' }) };
    if (r.itemId) {
      const item = book.items.find(i => i.id === r.itemId && i.domain === 'maintenance');
      if (!item) return { error: fail('NOT_FOUND', `Line ${n + 1}: that item is not on the maintenance price list.`, 404, { items: 'Pick an item from the list.' }) };
      const a = book.amounts(item.id, unitId, layout, today);
      if (a.owner == null) return { error: fail('VALIDATION', `${item.name} has no owner price yet. Set it in Service prices, or use Other.`, 422, { items: 'That item has no price.' }) };
      lines.push({ item_id: item.id, name: item.name, qty, owner_price: a.owner, internal_cost: a.internal });
    } else {
      const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
      if (typeof r?.name !== 'string' || !r.name.trim()) return { error: fail('VALIDATION', `Line ${n + 1}: say what the Other item is.`, 422, { items: 'Name the Other item.' }) };
      if (!ok(r.ownerPrice) || (r.internalCost != null && !ok(r.internalCost))) return { error: fail('VALIDATION', `Line ${n + 1}: enter the owner price (and the internal cost if known).`, 422, { items: 'Enter the prices.' }) };
      lines.push({ item_id: null, name: r.name.trim().slice(0, 160), qty, owner_price: r.ownerPrice, internal_cost: r.internalCost ?? null });
    }
  }
  return { lines };
}

/** The owner price of the lines: their sum, to the sen. */
export const linesTotal = (lines: Line[]) => Math.round(lines.reduce((s, l) => s + l.owner_price * l.qty, 0));

/** Replaces a job's lines. */
export async function writeLines(env: Env, issueId: string, lines: Line[], userId: string) {
  await run(env, 'DELETE FROM maintenance_job_items WHERE issue_id = ?', issueId);
  if (lines.length) await run(env, `INSERT INTO maintenance_job_items (id, issue_id, item_id, name, qty, owner_price, internal_cost, sort_order, created_at, created_by)
    SELECT gen_random_uuid()::text, ?, x.item_id, x.name, x.qty, x.owner_price, x.internal_cost, x.sort, ?, ?
    FROM jsonb_to_recordset(?::text::jsonb) AS x(item_id text, name text, qty numeric, owner_price int, internal_cost int, sort int)`,
    issueId, nowIso(), userId, JSON.stringify(lines.map((l, i) => ({ ...l, sort: i }))));
}
