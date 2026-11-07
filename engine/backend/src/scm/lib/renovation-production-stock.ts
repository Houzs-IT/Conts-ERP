/* Stock leaving a production order at Start and coming back (owner, 6 Nov 2026). Movements carry the material's id as their
   source, so the ledger itself says what already left: a retry after a stop midway issues only the rest, never twice. */

import { reverseMovements, writeMovements } from './inventory-movements';
import { allocateIssue, wholeNeed, type WarehouseStock } from './renovation-production';

export const PRODUCTION_DOC = 'PRODUCTION_ORDER';

type MaterialRow = { id: string; item_code: string; description: string | null; qty_needed: number | string; qty_issued: number; qty_returned: number; qty_issued_short: number };
const MATERIAL_COLS = 'id, item_code, description, qty_needed, qty_issued, qty_returned, qty_issued_short';

/** Pooled stock per SKU, by warehouse. On-site holds no countable stock (migration 0225's rule), so nothing is issued from it. */
export async function pooledStock(sb: any, companyId: number, codes: string[]): Promise<{ byCode: Map<string, WarehouseStock[]>; fallback: string | null; error: string | null }> {
  const { data: wh, error: whErr } = await sb.from('warehouses').select('id, code, is_default').eq('company_id', companyId);
  if (whErr) return { byCode: new Map(), fallback: null, error: whErr.message };
  const rows = (wh ?? []) as Array<{ id: string; code: string; is_default: boolean | null }>;
  const onSite = new Set(rows.filter((r) => r.code.toUpperCase() === 'ONSITE').map((r) => r.id));
  const usable = rows.filter((r) => !onSite.has(r.id));
  const fallback = (usable.find((r) => r.is_default) ?? usable[0])?.id ?? null;
  const byCode = new Map<string, WarehouseStock[]>();
  if (codes.length === 0) return { byCode, fallback, error: null };
  const { data: bal, error } = await sb.from('inventory_balances').select('warehouse_id, item_code, variant_key, qty').eq('company_id', companyId).in('item_code', codes);
  if (error) return { byCode, fallback, error: error.message };
  for (const b of (bal ?? []) as Array<{ warehouse_id: string; item_code: string; variant_key: string | null; qty: number }>) {
    if (onSite.has(b.warehouse_id) || (b.variant_key ?? '') !== '') continue;
    const list = byCode.get(b.item_code) ?? [];
    list.push({ warehouseId: b.warehouse_id, qty: Number(b.qty) });
    byCode.set(b.item_code, list);
  }
  return { byCode, fallback, error: null };
}

/* Out minus in, so a Start after a reversal issues again. Return stock's INs are added back by the caller: a return lowers
   what is out, not what was issued. */
async function netOutFromLedger(sb: any, ids: string[]): Promise<{ netOut: Map<string, number>; error: string | null }> {
  const netOut = new Map<string, number>();
  if (ids.length === 0) return { netOut, error: null };
  const { data, error } = await sb.from('inventory_movements').select('source_doc_id, movement_type, qty').eq('source_doc_type', PRODUCTION_DOC).in('source_doc_id', ids);
  if (error) return { netOut, error: error.message };
  for (const r of (data ?? []) as Array<{ source_doc_id: string; movement_type: string; qty: number }>) {
    const signed = r.movement_type === 'OUT' ? Number(r.qty) : r.movement_type === 'IN' ? -Number(r.qty) : 0;
    netOut.set(r.source_doc_id, (netOut.get(r.source_doc_id) ?? 0) + signed);
  }
  return { netOut, error: null };
}

export type IssueContext = { orderId: string; poNumber: string; companyId: number; performedBy: string | null; only?: string[] };

/** Brings every material up to its whole need. A failed write is returned as words and the order does not move on. */
export async function issueMaterials(sb: any, x: IssueContext): Promise<{ ok: true; issuedLines: number; shortLines: number } | { ok: false; reason: string }> {
  let q = sb.from('production_order_materials').select(MATERIAL_COLS).eq('production_order_id', x.orderId);
  if (x.only) q = q.in('id', x.only);
  const { data, error } = await q;
  if (error) return { ok: false, reason: error.message };
  const materials = (data ?? []) as MaterialRow[];
  if (materials.length === 0) return { ok: true, issuedLines: 0, shortLines: 0 };
  const ledger = await netOutFromLedger(sb, materials.map((m) => m.id));
  if (ledger.error) return { ok: false, reason: ledger.error };
  const stock = await pooledStock(sb, x.companyId, [...new Set(materials.map((m) => m.item_code))]);
  if (stock.error) return { ok: false, reason: stock.error };

  const movements: Array<Parameters<typeof writeMovements>[1][number]> = [];
  const stamps: Array<{ m: MaterialRow; issued: number; short: number }> = [];
  for (const m of materials) {
    const already = (ledger.netOut.get(m.id) ?? 0) + m.qty_returned;
    const need = wholeNeed(m.qty_needed);
    const delta = need - already;
    if (delta <= 0) {
      if (already !== m.qty_issued) stamps.push({ m, issued: already, short: m.qty_issued_short });
      continue;
    }
    const { picks, short } = allocateIssue(delta, stock.byCode.get(m.item_code) ?? [], stock.fallback);
    if (picks.length === 0) return { ok: false, reason: 'Add a warehouse first: there is nowhere to issue this stock from.' };
    for (const p of picks) {
      movements.push({
        movement_type: 'OUT', warehouse_id: p.warehouseId, item_code: m.item_code, variant_key: '', product_name: m.description, qty: p.qty,
        source_doc_type: PRODUCTION_DOC, source_doc_id: m.id, source_doc_no: x.poNumber, performed_by: x.performedBy,
      } as never);
    }
    stamps.push({ m, issued: need, short: m.qty_issued_short + short });
  }
  if (movements.length > 0) {
    const wrote = await writeMovements(sb, movements, x.companyId);
    if (!wrote.ok) return { ok: false, reason: `The stock did not move, so nothing was started: ${wrote.reason ?? 'unknown'}` };
  }
  for (const s of stamps) {
    const { error: upErr } = await sb.from('production_order_materials').update({ qty_issued: s.issued, qty_issued_short: s.short, updated_at: new Date().toISOString() }).eq('id', s.m.id);
    if (upErr) return { ok: false, reason: upErr.message };
  }
  return { ok: true, issuedLines: stamps.length, shortLines: stamps.filter((s) => s.short > s.m.qty_issued_short).length };
}

/** Sends back part of what left, into the warehouse picked. The count is claimed first, so two presses cannot both return. */
export async function returnMaterial(sb: any, x: { m: MaterialRow; qty: number; warehouseId: string; poNumber: string; companyId: number; performedBy: string | null }): Promise<string | null> {
  const nextReturned = x.m.qty_returned + x.qty;
  const { data: claimed, error } = await sb.from('production_order_materials').update({ qty_returned: nextReturned, updated_at: new Date().toISOString() })
    .eq('id', x.m.id).eq('qty_returned', x.m.qty_returned).select('id');
  if (error) return error.message;
  if (!(claimed ?? []).length) return `${x.m.item_code} changed while you were returning it. Refresh and try again.`;
  const { data: outs } = await sb.from('inventory_movements').select('qty, unit_cost_sen').eq('source_doc_type', PRODUCTION_DOC).eq('source_doc_id', x.m.id).eq('movement_type', 'OUT');
  const rows = (outs ?? []) as Array<{ qty: number; unit_cost_sen: number | null }>;
  const units = rows.reduce((t, r) => t + Number(r.qty), 0);
  const unitCost = units > 0 ? Math.round(rows.reduce((t, r) => t + Number(r.qty) * Number(r.unit_cost_sen ?? 0), 0) / units) : 0;
  const wrote = await writeMovements(sb, [{
    movement_type: 'IN', warehouse_id: x.warehouseId, item_code: x.m.item_code, variant_key: '', product_name: x.m.description, qty: x.qty, unit_cost_sen: unitCost,
    source_doc_type: PRODUCTION_DOC, source_doc_id: x.m.id, source_doc_no: x.poNumber, performed_by: x.performedBy,
  } as never], x.companyId);
  if (wrote.ok) return null;
  await sb.from('production_order_materials').update({ qty_returned: x.m.qty_returned }).eq('id', x.m.id);
  return `The stock did not go back: ${wrote.reason ?? 'unknown'}`;
}

/** Cancel and reopen after Start put everything still out back in stock, where it left from. Safe to repeat. */
export async function reverseIssues(sb: any, orderId: string, performedBy: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await sb.from('production_order_materials').select('id, item_code').eq('production_order_id', orderId);
  if (error) return { ok: false, reason: error.message };
  for (const m of (data ?? []) as Array<{ id: string; item_code: string }>) {
    const r = await reverseMovements(sb, PRODUCTION_DOC, m.id, performedBy);
    if (!r.ok) return { ok: false, reason: `${m.item_code} did not go back to stock: ${r.reason ?? `${r.failed} movement(s) failed`}` };
    const { error: upErr } = await sb.from('production_order_materials').update({ qty_issued: 0, qty_returned: 0, qty_issued_short: 0, updated_at: new Date().toISOString() }).eq('id', m.id);
    if (upErr) return { ok: false, reason: upErr.message };
  }
  return { ok: true };
}
