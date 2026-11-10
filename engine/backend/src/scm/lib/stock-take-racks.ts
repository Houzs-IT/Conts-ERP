// stock-take-racks — at POST, the goods go on the racks the counter found them
// on (owner 2026-10-06: 过账时真的搬到那个 rack). The rack ledger
// (warehouse_rack_items / _movements) is separate from FIFO stock and is
// placement only — so this is best-effort like the GRN sync
// (lib/grn-rack-sync.ts), never a reason to fail a post.
//
// The rule, per counted (item code, variant) pair at the take's warehouse:
//   - every counted line of the pair (counted > 0) names a rack → the pair's
//     old placements in this warehouse are taken off (STOCK_OUT) and the counted
//     quantity is placed on the named rack(s) (STOCK_IN);
//   - any counted line of the pair has no rack → the pair is left alone: a
//     partial answer would wipe placements nobody re-stated.
// Placements of a variant nobody counted are never touched: a take that counted
// only one variant of a code must not wipe where the code's other variants sit.
// The variant-less '' placement (what a GRN writes) is cleared only when '' is
// what was counted.
//
// REVERSE. The post records what it took off (the full rows) and the ids it put
// on, in stock_takes.rack_moves. PATCH /:id/reverse hands that record to
// reverseStockTakeRacks, which takes the placed rows off (whatever is left of
// them) and puts the old rows back as they were. Best-effort the same way.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { todayMyt } from './my-time';
import { deriveRackStatus } from './grn-rack-sync';
import { paginateAll, chunkIn } from './paginate-all';

export type RackCountLine = { item_code: string; variant_key: string | null; product_name: string | null; counted_qty: number | null; rack_id: string | null };
/** A warehouse_rack_items row. The named fields drive the plan; the rest ride
    along so a reverse can put the row back exactly as it was. */
export type RackPlacement = {
  id: string; rack_id: string; item_code: string; variant_key?: string | null; product_name: string | null; qty: number;
  [col: string]: unknown;
};

export type RackMovePlan = {
  remove: RackPlacement[];
  place: Array<{ rack_id: string; item_code: string; variant_key: string; product_name: string | null; qty: number }>;
  /** "CODE" or "CODE (variant)" per pair left alone because a counted line had no rack. */
  skippedCodes: string[];
};

/** What one post did to the racks, kept on the take (stock_takes.rack_moves) for the reverse. */
export type RackMovesRecord = { removed: RackPlacement[]; placedIds: string[] };

/** Every warehouse_rack_items column, so a removed row can be restored whole. */
const PLACEMENT_COLS =
  'id, rack_id, item_code, variant_key, product_name, size_label, customer_name, source_doc_no, qty, ' +
  'stocked_in_date, notes, created_at, source_grn_id, company_id';

const pairLabel = (code: string, vk: string) => (vk ? `${code} (${vk})` : code);

/** Pure: what to take off and what to put on. `existing` = this warehouse's placements of the counted codes. */
export const planStockTakeRackMoves = (lines: readonly RackCountLine[], existing: readonly RackPlacement[]): RackMovePlan => {
  const byPair = new Map<string, { code: string; vk: string; ls: RackCountLine[] }>();
  for (const l of lines) {
    if ((l.counted_qty ?? 0) <= 0) continue;
    const vk = l.variant_key ?? '';
    const k = `${l.item_code}\u0000${vk}`;
    const cur = byPair.get(k) ?? { code: l.item_code, vk, ls: [] };
    cur.ls.push(l);
    byPair.set(k, cur);
  }
  const plan: RackMovePlan = { remove: [], place: [], skippedCodes: [] };
  for (const { code, vk, ls } of byPair.values()) {
    if (!ls.some((l) => l.rack_id)) continue; // nobody wrote a rack: nothing to say
    if (ls.some((l) => !l.rack_id)) { plan.skippedCodes.push(pairLabel(code, vk)); continue; }
    plan.remove.push(...existing.filter((p) => p.item_code === code && (p.variant_key ?? '') === vk));
    const perRack = new Map<string, number>();
    for (const l of ls) perRack.set(l.rack_id!, (perRack.get(l.rack_id!) ?? 0) + (l.counted_qty ?? 0));
    for (const [rack_id, qty] of perRack) {
      plan.place.push({ rack_id, variant_key: vk, qty, item_code: code, product_name: ls[0]!.product_name });
    }
  }
  return plan;
};

type WarehouseRacks = { ids: string[]; label: Map<string, string>; reserved: Map<string, boolean>; error: string | null };

async function rackLabels(sb: any, warehouseId: string, companyId: number): Promise<WarehouseRacks> {
  const { data: racks, error } = await sb.from('warehouse_racks')
    .select('id, rack, reserved').eq('warehouse_id', warehouseId).eq('company_id', companyId);
  if (error) return { ids: [], label: new Map(), reserved: new Map(), error: error.message };
  const rows = (racks ?? []) as Array<{ id: string; rack: string; reserved: boolean | null }>;
  return {
    ids: rows.map((r) => r.id),
    label: new Map(rows.map((r) => [r.id, r.rack])),
    reserved: new Map(rows.map((r) => [r.id, r.reserved === true])),
    error: null,
  };
}

/** Rack status for every touched rack in a FIXED number of calls — one read of
    which touched racks still hold anything, then one update per resulting
    status (at most three). refreshRackStatus costs three calls per rack, and a
    take that touches a dozen racks would spend the Worker's 50-subrequest
    budget before the post's SO allocation recompute ran. */
export async function refreshRackStatuses(sb: any, racks: Pick<WarehouseRacks, 'reserved'>, rackIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(rackIds)];
  if (ids.length === 0) return;
  const { data: held, error } = await chunkIn<{ rack_id: string }>(ids, (batch, pFrom, pTo) => sb.from('warehouse_rack_items')
    .select('rack_id').in('rack_id', batch).order('id').range(pFrom, pTo));
  if (error) return; // best-effort, like the moves themselves
  const occupied = new Set(held.map((r) => r.rack_id));
  const byStatus = new Map<string, string[]>();
  for (const id of ids) {
    const st = deriveRackStatus(occupied.has(id) ? 1 : 0, racks.reserved.get(id) ?? false);
    byStatus.set(st, [...(byStatus.get(st) ?? []), id]);
  }
  for (const [status, rids] of byStatus) {
    await sb.from('warehouse_racks').update({ status }).in('id', rids);
  }
}

/** Apply the plan for one posted take. Best-effort; returns what it did. */
export async function applyStockTakeRacks(
  sb: any,
  args: { takeId: string; takeNo: string; warehouseId: string; companyId: number; performedBy: string },
): Promise<{ moved: number; skippedCodes: string[]; error: string | null }> {
  const { data: lines, error: lErr } = await paginateAll((pFrom, pTo) => sb.from('stock_take_lines')
    .select('item_code, variant_key, product_name, counted_qty, rack_id')
    .eq('stock_take_id', args.takeId).eq('company_id', args.companyId)
    .order('item_code').order('variant_key').order('id').range(pFrom, pTo));
  if (lErr) return { moved: 0, skippedCodes: [], error: lErr.message };
  const counted = ((lines ?? []) as RackCountLine[]).filter((l) => (l.counted_qty ?? 0) > 0 && l.rack_id);
  if (counted.length === 0) return { moved: 0, skippedCodes: [], error: null };

  const racks = await rackLabels(sb, args.warehouseId, args.companyId);
  if (racks.error) return { moved: 0, skippedCodes: [], error: racks.error };
  const codes = [...new Set(counted.map((l) => l.item_code))];
  /* Chunked + paged: a whole-warehouse take counts thousands of codes. */
  const rackSet = new Set(racks.ids);
  const { data: existingAll, error: eErr } = racks.ids.length === 0
    ? { data: [] as RackPlacement[], error: null }
    : await chunkIn<RackPlacement>(codes, (batch, pFrom, pTo) => sb.from('warehouse_rack_items')
      .select(PLACEMENT_COLS)
      .eq('company_id', args.companyId)
      .in('item_code', batch)
      .order('id').range(pFrom, pTo));
  const existing = (existingAll ?? []).filter((p) => rackSet.has(p.rack_id));
  if (eErr) return { moved: 0, skippedCodes: [], error: eErr.message };

  const plan = planStockTakeRackMoves((lines ?? []) as RackCountLine[], (existing ?? []) as RackPlacement[]);
  if (plan.place.length === 0) return { moved: 0, skippedCodes: plan.skippedCodes, error: null };

  const base = { company_id: args.companyId, warehouse_id: args.warehouseId, source_doc_no: args.takeNo, performed_by: args.performedBy };
  if (plan.remove.length > 0) {
    let dErr: { message: string } | null = null;
    for (let i = 0; i < plan.remove.length && !dErr; i += 200) {
      ({ error: dErr } = await sb.from('warehouse_rack_items').delete().in('id', plan.remove.slice(i, i + 200).map((p) => p.id)));
    }
    if (dErr) return { moved: 0, skippedCodes: plan.skippedCodes, error: dErr.message };
    await sb.from('warehouse_rack_movements').insert(plan.remove.map((p) => ({
      ...base, movement_type: 'STOCK_OUT', rack_id: p.rack_id, rack_label: racks.label.get(p.rack_id) ?? null,
      item_code: p.item_code, variant_key: p.variant_key ?? '', product_name: p.product_name, quantity: p.qty,
      reason: 'Stock take — moved to counted rack',
    })));
  }
  const today = todayMyt();
  const { data: placed, error: iErr } = await sb.from('warehouse_rack_items').insert(plan.place.map((p) => ({
    company_id: args.companyId, rack_id: p.rack_id, item_code: p.item_code, variant_key: p.variant_key, product_name: p.product_name,
    qty: p.qty, source_doc_no: args.takeNo, stocked_in_date: today, notes: 'Stock take',
  }))).select('id');
  if (iErr) {
    await recordRackMoves(sb, args, { removed: plan.remove, placedIds: [] });
    return { moved: 0, skippedCodes: plan.skippedCodes, error: iErr.message };
  }
  await recordRackMoves(sb, args, {
    removed: plan.remove,
    placedIds: ((placed ?? []) as Array<{ id: string }>).map((r) => r.id),
  });
  await sb.from('warehouse_rack_movements').insert(plan.place.map((p) => ({
    ...base, movement_type: 'STOCK_IN', rack_id: p.rack_id, rack_label: racks.label.get(p.rack_id) ?? null,
    item_code: p.item_code, variant_key: p.variant_key, product_name: p.product_name, quantity: p.qty, reason: 'Stock take — counted on this rack',
  })));
  await refreshRackStatuses(sb, racks, [...plan.remove.map((p) => p.rack_id), ...plan.place.map((p) => p.rack_id)]);
  return { moved: plan.place.length, skippedCodes: plan.skippedCodes, error: null };
}

async function recordRackMoves(sb: any, args: { takeId: string; companyId: number }, rec: RackMovesRecord): Promise<void> {
  await sb.from('stock_takes').update({ rack_moves: rec }).eq('id', args.takeId).eq('company_id', args.companyId);
}

/** Undo what applyStockTakeRacks did for one take (on reverse). Best-effort;
    the placed rows are taken off as they now stand (some may have been picked
    or moved since), the removed rows go back whole. */
export async function reverseStockTakeRacks(
  sb: any,
  args: { takeId: string; takeNo: string; warehouseId: string; companyId: number; performedBy: string },
): Promise<{ restored: number; removed: number; error: string | null }> {
  const { data: take, error: tErr } = await sb.from('stock_takes')
    .select('rack_moves').eq('id', args.takeId).eq('company_id', args.companyId).maybeSingle();
  if (tErr) return { restored: 0, removed: 0, error: tErr.message };
  const rec = (take?.rack_moves ?? null) as RackMovesRecord | null;
  if (!rec || ((rec.placedIds ?? []).length === 0 && (rec.removed ?? []).length === 0)) return { restored: 0, removed: 0, error: null };

  const racks = await rackLabels(sb, args.warehouseId, args.companyId);
  const base = { company_id: args.companyId, warehouse_id: args.warehouseId, source_doc_no: args.takeNo, performed_by: args.performedBy };
  const touched = new Set<string>();

  let removedRows: RackPlacement[] = [];
  if ((rec.placedIds ?? []).length > 0) {
    // What is left of the placed rows (some may have been picked or moved since).
    const { data: left, error: sErr } = await sb.from('warehouse_rack_items')
      .select(PLACEMENT_COLS).in('id', rec.placedIds).eq('company_id', args.companyId);
    if (sErr) return { restored: 0, removed: 0, error: sErr.message };
    removedRows = (left ?? []) as RackPlacement[];
    if (removedRows.length > 0) {
      const { error: dErr } = await sb.from('warehouse_rack_items')
        .delete().in('id', removedRows.map((p) => p.id)).eq('company_id', args.companyId);
      if (dErr) return { restored: 0, removed: 0, error: dErr.message };
      await sb.from('warehouse_rack_movements').insert(removedRows.map((p) => ({
        ...base, movement_type: 'STOCK_OUT', rack_id: p.rack_id, rack_label: racks.label.get(p.rack_id) ?? null,
        item_code: p.item_code, variant_key: p.variant_key ?? '', product_name: p.product_name, quantity: p.qty,
        reason: 'Stock take reversed — taken off the counted rack',
      })));
    }
    for (const p of removedRows) touched.add(p.rack_id);
  }

  const back = rec.removed ?? [];
  if (back.length > 0) {
    const { error: iErr } = await sb.from('warehouse_rack_items').insert(back);
    if (iErr) return { restored: 0, removed: removedRows.length, error: iErr.message };
    await sb.from('warehouse_rack_movements').insert(back.map((p) => ({
      ...base, movement_type: 'STOCK_IN', rack_id: p.rack_id, rack_label: racks.label.get(p.rack_id) ?? null,
      item_code: p.item_code, variant_key: p.variant_key ?? '', product_name: p.product_name, quantity: p.qty,
      reason: 'Stock take reversed — back on the rack it was on',
    })));
    for (const p of back) touched.add(p.rack_id);
  }
  await refreshRackStatuses(sb, racks, touched);
  return { restored: back.length, removed: removedRows.length, error: null };
}
