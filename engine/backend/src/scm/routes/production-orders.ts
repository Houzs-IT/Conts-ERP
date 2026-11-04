/* Production orders: /api/scm/production-orders (owner, 1 and 4 Nov 2026; spec
   docs/superpowers/specs/2026-11-01-dates-categories-production-design.md).

   A production order is never made here: scm.production_sync_po (migration 0208) creates it when a PO to INHOUSE is
   issued and keeps it equal to that PO. This router reads it, plans it (dates, status, materials) and turns the
   shortages MRP finds into raw-material POs through the one PO create there is. Reads ride the area's view level,
   writes its edit level (scm/index.ts). */

import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { requireActiveCompanyId, scopeToCompanyId, NOT_THIS_COMPANY } from '../lib/companyScope';
import { paginateAll, chunkIn } from '../lib/paginate-all';
import { pgrestInList } from '../lib/pgrest-in-list';
import { readMfgProductBindings } from '../lib/supplier-bindings';
import { recordEntityAudit, compactChanges, fieldChange, statusChange } from '../lib/entity-audit';
import { dateOrNull } from '../lib/date-coerce';
import { createMfgPurchaseOrderHandler } from './mfg-purchase-orders';

export const productionOrders = new Hono<{ Bindings: Env; Variables: Variables }>();
productionOrders.use('*', supabaseAuth);

export const PRODUCTION_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const INHOUSE_CODE = 'INHOUSE';
const RAW_CATEGORY = 'RAW';

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e8 ? Math.round(n * 1000) / 1000 : null;
};

/* The status a person may set: a cancelled order follows its PO, so it comes back only when the PO does. */
export function productionStatusRefusal(current: string, next: unknown): string | null {
  if (current === 'CANCELLED') return 'This production order is cancelled with its purchase order. Reopen the purchase order instead.';
  if (next === 'CANCELLED') return 'A production order is cancelled by cancelling its purchase order.';
  if (!PRODUCTION_STATUSES.includes(next as (typeof PRODUCTION_STATUSES)[number])) return 'That is not a production order status.';
  return null;
}

export type MaterialPick = { materialId: string; qty: number; supplierId: string; warehouseId: string; projectId: number | null };

/* One PO per supplier, warehouse and project: a renovation PO belongs to one project, and goods land in one place. */
export function groupMaterialPicks<T extends MaterialPick>(picks: readonly T[]): T[][] {
  const by = new Map<string, T[]>();
  for (const p of picks) {
    const k = `${p.supplierId}|${p.warehouseId}|${p.projectId ?? ''}`;
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.values()];
}

type OrderRow = {
  id: string; doc_no: string; company_id: number; source_po_id: string; project_id: number | null; so_doc_no: string | null;
  warehouse_id: string | null; status: string; processing_date: string | null; target_date: string | null;
  amount_sen: number; actual_cost_sen: number; notes: string | null; created_at: string; updated_at: string;
};
const ORDER_COLS = 'id, doc_no, company_id, source_po_id, project_id, so_doc_no, warehouse_id, status, processing_date, target_date, amount_sen, actual_cost_sen, notes, created_at, updated_at';

const projectsById = async (sb: any, companyId: number, ids: number[]) => {
  const out = new Map<number, { code: string | null; name: string | null }>();
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return out;
  const { data, error } = await sb.schema('public').from('projects').select('id, code, name').eq('company_id', companyId).in('id', wanted);
  if (error) throw new Error(error.message);
  for (const p of (data ?? []) as Array<{ id: number; code: string | null; name: string | null }>) out.set(Number(p.id), { code: p.code, name: p.name });
  return out;
};

const loadOrder = async (sb: any, companyId: number, id: string): Promise<OrderRow | null> => {
  const { data } = await scopeToCompanyId(sb.from('production_orders').select(ORDER_COLS).eq('id', id), companyId).maybeSingle();
  return (data as OrderRow | null) ?? null;
};

productionOrders.get('/', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data, error } = await paginateAll<OrderRow & { po: { po_number: string; status: string } | null; materials: Array<{ qty_needed: number; qty_ordered: number; qty_received: number }> }>((from, to) =>
    scopeToCompanyId(sb.from('production_orders').select(`${ORDER_COLS}, po:purchase_orders!source_po_id (po_number, status), materials:production_order_materials (qty_needed, qty_ordered, qty_received)`), co.companyId)
      .order('created_at', { ascending: false }).order('id').range(from, to) as never);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = data ?? [];
  const projects = await projectsById(sb, co.companyId, rows.map((r) => Number(r.project_id)));
  return c.json({
    productionOrders: rows.map(({ po, materials, ...r }) => ({
      ...r,
      po_number: po?.po_number ?? null,
      po_status: po?.status ?? null,
      project_code: r.project_id ? projects.get(Number(r.project_id))?.code ?? null : null,
      project_name: r.project_id ? projects.get(Number(r.project_id))?.name ?? null : null,
      material_count: materials.length,
      materials_received: materials.filter((m) => Number(m.qty_received) >= Number(m.qty_needed)).length,
    })),
  });
});

/* The production order a PO became, for the PO's own page. */
productionOrders.get('/by-po/:poId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { data, error } = await scopeToCompanyId(c.get('supabase').from('production_orders').select('id, doc_no, status, amount_sen, actual_cost_sen').eq('source_po_id', c.req.param('poId')), co.companyId).maybeSingle();
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ productionOrder: data ?? null });
});

/* The raw material SKUs a material can be, and the works SKUs a list can start from. */
productionOrders.get('/skus', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const raw = c.req.query('kind') !== 'works';
  const { data, error } = await paginateAll<{ code: string; name: string | null; uom: string | null; category: string }>((from, to) => {
    const q = scopeToCompanyId(c.get('supabase').from('mfg_products').select('code, name, uom, category').eq('status', 'ACTIVE'), co.companyId);
    return (raw ? q.eq('category', RAW_CATEGORY) : q.eq('category', 'WORKS')).order('code').range(from, to) as never;
  });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ skus: data ?? [] });
});

/* ── The material list: works SKU -> raw material SKU x qty per unit ── */

productionOrders.get('/material-list', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const { data, error } = await paginateAll<{ id: string; works_item_code: string; raw_item_code: string; qty_per_unit: number; notes: string | null }>((from, to) =>
    scopeToCompanyId(sb.from('production_material_lists').select('id, works_item_code, raw_item_code, qty_per_unit, notes'), co.companyId)
      .order('works_item_code').order('raw_item_code').range(from, to) as never);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  const rows = data ?? [];
  const codes = [...new Set(rows.flatMap((r) => [r.works_item_code, r.raw_item_code]))];
  const { data: names, error: nameErr } = await chunkIn<{ code: string; name: string | null; uom: string | null }>(codes, (batch, from, to) =>
    scopeToCompanyId(sb.from('mfg_products').select('code, name, uom').filter('code', 'in', pgrestInList(batch)), co.companyId).order('id').range(from, to) as never);
  if (nameErr) return c.json({ error: 'load_failed', reason: nameErr.message }, 500);
  const byCode = new Map(names.map((n) => [n.code, n]));
  return c.json({
    rows: rows.map((r) => ({
      ...r,
      works_name: byCode.get(r.works_item_code)?.name ?? null,
      raw_name: byCode.get(r.raw_item_code)?.name ?? null,
      uom: byCode.get(r.raw_item_code)?.uom ?? null,
    })),
  });
});

/* Refuses a raw material code that is not an active SKU of the Raw material category. */
const rawSkuRefusal = async (sb: any, companyId: number, code: string): Promise<string | null> => {
  const { data } = await scopeToCompanyId(sb.from('mfg_products').select('code, category').eq('code', code), companyId).limit(1);
  const row = (data ?? [])[0] as { category: string } | undefined;
  if (!row) return `${code} is not in Products.`;
  return String(row.category) === RAW_CATEGORY ? null : `${code} is not in the Raw material category.`;
};

productionOrders.post('/material-list', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const works = String(b.worksItemCode ?? '').trim();
  const raw = String(b.rawItemCode ?? '').trim();
  const qty = positive(b.qtyPerUnit);
  if (!works || !raw || qty == null) return c.json({ error: 'validation', message: 'Choose a works SKU and a raw material, and give a quantity above zero.' }, 422);
  const bad = await rawSkuRefusal(sb, co.companyId, raw);
  if (bad) return c.json({ error: 'validation', message: bad }, 422);
  const { data, error } = await sb.from('production_material_lists')
    .upsert({ company_id: co.companyId, works_item_code: works, raw_item_code: raw, qty_per_unit: qty, notes: b.notes ? String(b.notes) : null, updated_at: new Date().toISOString(), updated_by: c.get('houzsUser')?.id ?? null },
      { onConflict: 'company_id,works_item_code,raw_item_code' })
    .select('id').single();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true, id: (data as { id: string }).id }, 201);
});

productionOrders.patch('/material-list/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const qty = positive(b.qtyPerUnit);
  if (qty == null) return c.json({ error: 'validation', message: 'Give a quantity above zero.' }, 422);
  const { error } = await scopeToCompanyId(c.get('supabase').from('production_material_lists')
    .update({ qty_per_unit: qty, notes: b.notes === undefined ? undefined : (b.notes ? String(b.notes) : null), updated_at: new Date().toISOString(), updated_by: c.get('houzsUser')?.id ?? null })
    .eq('id', c.req.param('id')), co.companyId);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

productionOrders.delete('/material-list/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { error } = await scopeToCompanyId(c.get('supabase').from('production_material_lists').delete().eq('id', c.req.param('id')), co.companyId);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* ── MRP shortages -> raw-material POs ──
   MRP's Proceed PO sends its raw-material picks here; SO picks keep going to /from-sos. Each PO goes through
   createMfgPurchaseOrderHandler, the same create a PO typed by hand goes through, and lands as the MRP page's POs do:
   confirmed, not emailed. The link back to the material is written in one call so the request stays small. */
productionOrders.post('/material-pos', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const b = (await c.req.json().catch(() => ({}))) as { picks?: Array<{ materialId?: string; qty?: number; supplierId?: string | null }>; expectedAt?: string };
  const picks = (b.picks ?? []).filter((p) => p.materialId && Number(p.qty) > 0);
  if (picks.length === 0) return c.json({ error: 'validation', message: 'Nothing to order.' }, 422);

  type MaterialRow = { id: string; item_code: string; description: string | null; production_order_id: string; order: { doc_no: string; status: string; warehouse_id: string | null; project_id: number | null; processing_date: string | null } | null };
  const { data: mats, error: matErr } = await scopeToCompanyId(sb.from('production_order_materials')
    .select('id, item_code, description, production_order_id, order:production_orders (doc_no, status, warehouse_id, project_id, processing_date)')
    .in('id', picks.map((p) => String(p.materialId))), co.companyId);
  if (matErr) return c.json({ error: 'load_failed', reason: matErr.message }, 500);
  const byId = new Map(((mats ?? []) as unknown as MaterialRow[]).map((m) => [m.id, m]));

  const codes = [...new Set([...byId.values()].map((m) => m.item_code))];
  const { data: binds, error: bindErr } = await readMfgProductBindings<{ item_code: string; supplier_id: string; unit_price_sen: number; is_main_supplier: boolean }>(sb, {
    codes, companyId: co.companyId, select: 'item_code, supplier_id, unit_price_sen, is_main_supplier',
  });
  if (bindErr) return c.json({ error: 'load_failed', reason: bindErr.message }, 500);
  const { data: inhouse } = await scopeToCompanyId(sb.from('suppliers').select('id').eq('code', INHOUSE_CODE), co.companyId).maybeSingle();
  const inhouseId = (inhouse as { id: string } | null)?.id ?? null;
  const { data: prods } = await chunkIn<{ code: string; name: string | null; cost_price_sen: number | null }>(codes, (batch, from, to) =>
    scopeToCompanyId(sb.from('mfg_products').select('code, name, cost_price_sen').filter('code', 'in', pgrestInList(batch)), co.companyId).order('id').range(from, to) as never);
  const prodOf = new Map(prods.map((p) => [p.code, p]));

  const resolved: Array<MaterialPick & { itemCode: string; name: string; unitPriceSen: number; deliveryDate: string | null }> = [];
  const noSupplier: string[] = [];
  for (const p of picks) {
    const m = byId.get(String(p.materialId));
    if (!m || !m.order) return c.json({ error: 'validation', message: 'A picked material no longer exists. Refresh MRP.' }, 409);
    if (!['PLANNED', 'IN_PROGRESS'].includes(m.order.status)) return c.json({ error: 'validation', message: `${m.order.doc_no} is ${m.order.status.toLowerCase()}.` }, 409);
    if (!m.order.warehouse_id) return c.json({ error: 'validation', message: `${m.order.doc_no} has no warehouse: set one on its purchase order.` }, 409);
    const own = binds.filter((x) => x.item_code === m.item_code);
    const supplierId = p.supplierId ?? own[0]?.supplier_id ?? null;
    if (!supplierId) { noSupplier.push(m.item_code); continue; }
    if (supplierId === inhouseId) return c.json({ error: 'validation', message: `${m.item_code} is bought from an outside supplier, not the In-house Production Team.` }, 409);
    resolved.push({
      materialId: m.id,
      /* A PO line counts whole units; a material may need 2.5 bags. */
      qty: Math.ceil(Number(p.qty)),
      supplierId,
      warehouseId: m.order.warehouse_id,
      projectId: m.order.project_id == null ? null : Number(m.order.project_id),
      itemCode: m.item_code,
      name: prodOf.get(m.item_code)?.name ?? m.description ?? m.item_code,
      unitPriceSen: Number(own.find((x) => x.supplier_id === supplierId)?.unit_price_sen ?? prodOf.get(m.item_code)?.cost_price_sen ?? 0),
      deliveryDate: dateOrNull(b.expectedAt) ?? m.order.processing_date,
    });
  }
  if (noSupplier.length > 0) return c.json({ error: 'missing_bindings', itemCodes: [...new Set(noSupplier)], message: 'These SKUs have no supplier yet.' }, 400);

  const created: Array<{ id: string; poNumber: string }> = [];
  for (const group of groupMaterialPicks(resolved)) {
    const first = group[0]!;
    const body = {
      supplierId: first.supplierId,
      purchaseLocationId: first.warehouseId,
      expectedAt: group.map((g) => g.deliveryDate).filter(Boolean).sort()[0] ?? null,
      items: group.map((g) => ({
        materialKind: 'mfg_product', itemCode: g.itemCode, materialName: g.name, description: g.name, qty: g.qty,
        unitPriceSen: g.unitPriceSen, deliveryDate: g.deliveryDate, warehouseId: g.warehouseId,
      })),
    };
    const out = await createMfgPurchaseOrderHandler({
      req: { json: async () => body },
      get: (k: string) => c.get(k as 'supabase'),
      set: (k: string, v: unknown) => c.set(k as 'supabase', v as never),
      env: c.env,
      json: (j: unknown, status?: number) => ({ json: j, status: status ?? 200 }),
    }) as unknown as { json: { id?: string; poNumber?: string } & Record<string, unknown>; status: number };
    if (out.status >= 300 || !out.json.id) return c.json({ ...out.json, created }, out.status as 409);
    const { error: linkErr } = await sb.rpc('production_link_po', {
      p_po: out.json.id, p_materials: group.map((g) => g.materialId), p_project: first.projectId,
    });
    if (linkErr) return c.json({ error: 'link_failed', reason: linkErr.message, created: [...created, { id: out.json.id, poNumber: out.json.poNumber }] }, 500);
    created.push({ id: out.json.id, poNumber: String(out.json.poNumber) });
  }
  return c.json({ total: created.length, created }, 201);
});

/* ── One production order ── */

productionOrders.get('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrder(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  const [po, lines, materials] = await Promise.all([
    sb.from('purchase_orders').select('id, po_number, status, po_date, total_sen, supplier:suppliers (name)').eq('id', order.source_po_id).maybeSingle(),
    sb.from('production_order_lines').select('id, line_no, item_code, description, room, qty, uom, unit_price_sen, line_total_sen, so_item_id').eq('production_order_id', order.id).order('line_no'),
    sb.from('production_order_materials').select('id, line_id, item_code, description, uom, qty_needed, qty_per_unit, from_list, qty_ordered, qty_received, unit_cost_sen, received_cost_sen, notes').eq('production_order_id', order.id).order('created_at'),
  ]);
  const err = po.error ?? lines.error ?? materials.error;
  if (err) return c.json({ error: 'load_failed', reason: err.message }, 500);
  const matRows = (materials.data ?? []) as Array<{ id: string }>;

  type PoLine = { id: string; production_material_id: string; qty: number; received_qty: number | null; line_total_sen: number; purchase_order_id: string; po: { po_number: string; status: string; po_email_sent_at: string | null; supplier: { name: string } | null } | null };
  const { data: poLineRows, error: poLineErr } = matRows.length === 0 ? { data: [], error: null } : await sb.from('purchase_order_items')
    .select('id, production_material_id, qty, received_qty, line_total_sen, purchase_order_id, po:purchase_orders (po_number, status, po_email_sent_at, supplier:suppliers (name))')
    .in('production_material_id', matRows.map((m) => m.id));
  if (poLineErr) return c.json({ error: 'load_failed', reason: poLineErr.message }, 500);
  const poLines = (poLineRows ?? []) as unknown as PoLine[];
  const linkedPos = new Map<string, { id: string; poNumber: string; status: string; supplier: string | null; emailed: boolean; totalSen: number }>();
  for (const l of poLines) {
    const cur = linkedPos.get(l.purchase_order_id) ?? { id: l.purchase_order_id, poNumber: l.po?.po_number ?? '', status: l.po?.status ?? '', supplier: l.po?.supplier?.name ?? null, emailed: !!l.po?.po_email_sent_at, totalSen: 0 };
    cur.totalSen += Number(l.line_total_sen ?? 0);
    linkedPos.set(l.purchase_order_id, cur);
  }

  type GrnLine = { qty_accepted: number; grn: { id: string; grn_number: string; status: string; received_at?: string | null } | null };
  const { data: grnRows, error: grnErr } = poLines.length === 0 ? { data: [], error: null } : await sb.from('grn_items')
    .select('qty_accepted, grn:grns (id, grn_number, status)')
    .in('purchase_order_item_id', poLines.map((l) => l.id));
  if (grnErr) return c.json({ error: 'load_failed', reason: grnErr.message }, 500);
  const grs = new Map<string, { id: string; grnNumber: string; status: string; qty: number }>();
  for (const g of (grnRows ?? []) as unknown as GrnLine[]) {
    if (!g.grn || g.grn.status === 'CANCELLED') continue;
    const cur = grs.get(g.grn.id) ?? { id: g.grn.id, grnNumber: g.grn.grn_number, status: g.grn.status, qty: 0 };
    cur.qty += Number(g.qty_accepted ?? 0);
    grs.set(g.grn.id, cur);
  }
  const project = order.project_id ? (await projectsById(sb, co.companyId, [Number(order.project_id)])).get(Number(order.project_id)) : undefined;
  return c.json({
    productionOrder: { ...order, project_code: project?.code ?? null, project_name: project?.name ?? null },
    sourcePo: po.data,
    lines: lines.data ?? [],
    materials: materials.data ?? [],
    linkedPos: [...linkedPos.values()],
    goodsReceipts: [...grs.values()],
  });
});

productionOrders.patch('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrder(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: c.get('houzsUser')?.id ?? null };
  if (b.status !== undefined) {
    const refusal = productionStatusRefusal(order.status, b.status);
    if (refusal) return c.json({ error: 'validation', message: refusal }, 409);
    updates.status = b.status;
  } else if (order.status === 'CANCELLED') {
    return c.json({ error: 'validation', message: productionStatusRefusal(order.status, null) }, 409);
  }
  if (b.processingDate !== undefined) updates.processing_date = dateOrNull(b.processingDate);
  if (b.targetDate !== undefined) updates.target_date = dateOrNull(b.targetDate);
  if (b.notes !== undefined) updates.notes = b.notes ? String(b.notes) : null;
  const { error } = await scopeToCompanyId(sb.from('production_orders').update(updates).eq('id', order.id), co.companyId);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  await recordEntityAudit(sb, {
    entityType: 'PRODUCTION_ORDER', entityId: order.id, entityDocNo: order.doc_no, action: 'UPDATE', actor: c.get('houzsUser'), companyId: co.companyId,
    statusSnapshot: String(updates.status ?? order.status),
    fieldChanges: compactChanges([
      ...(updates.status ? statusChange(order.status, String(updates.status)) : []),
      ...(updates.processing_date !== undefined ? [fieldChange('processingDate', order.processing_date, updates.processing_date ?? null)] : []),
      ...(updates.target_date !== undefined ? [fieldChange('targetDate', order.target_date, updates.target_date ?? null)] : []),
    ]),
  });
  return c.json({ ok: true });
});

productionOrders.post('/:id/materials', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrder(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  if (order.status === 'CANCELLED' || order.status === 'DONE') return c.json({ error: 'validation', message: `This production order is ${order.status.toLowerCase()}.` }, 409);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const code = String(b.itemCode ?? '').trim();
  const qty = positive(b.qtyNeeded);
  if (!code || qty == null) return c.json({ error: 'validation', message: 'Choose a raw material and give a quantity above zero.' }, 422);
  const bad = await rawSkuRefusal(sb, co.companyId, code);
  if (bad) return c.json({ error: 'validation', message: bad }, 422);
  const { data: prod } = await scopeToCompanyId(sb.from('mfg_products').select('name, uom').eq('code', code), co.companyId).limit(1);
  const p = ((prod ?? [])[0] ?? {}) as { name?: string; uom?: string };
  const { data, error } = await sb.from('production_order_materials').insert({
    production_order_id: order.id, company_id: co.companyId, item_code: code, description: p.name ?? null, uom: p.uom ?? null, qty_needed: qty, notes: b.notes ? String(b.notes) : null,
  }).select('id').single();
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true, id: (data as { id: string }).id }, 201);
});

/* Loads the material only through its own order, so another company's id answers 404. */
const loadMaterial = async (sb: any, companyId: number, orderId: string, materialId: string) => {
  const { data } = await scopeToCompanyId(sb.from('production_order_materials').select('id, qty_ordered, item_code').eq('id', materialId).eq('production_order_id', orderId), companyId).maybeSingle();
  return data as { id: string; qty_ordered: number; item_code: string } | null;
};

productionOrders.patch('/:id/materials/:materialId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const m = await loadMaterial(sb, co.companyId, c.req.param('id'), c.req.param('materialId'));
  if (!m) return c.json(NOT_THIS_COMPANY, 404);
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (b.qtyNeeded !== undefined) {
    const qty = positive(b.qtyNeeded);
    if (qty == null) return c.json({ error: 'validation', message: 'Give a quantity above zero.' }, 422);
    updates.qty_needed = qty;
    updates.from_list = false;
  }
  if (b.notes !== undefined) updates.notes = b.notes ? String(b.notes) : null;
  const { error } = await sb.from('production_order_materials').update(updates).eq('id', m.id);
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

productionOrders.delete('/:id/materials/:materialId', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const m = await loadMaterial(sb, co.companyId, c.req.param('id'), c.req.param('materialId'));
  if (!m) return c.json(NOT_THIS_COMPANY, 404);
  const { count, error: refErr } = await sb.from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('production_material_id', m.id);
  if (refErr) return c.json({ error: 'load_failed', reason: refErr.message }, 500);
  if ((count ?? 0) > 0) return c.json({ error: 'validation', message: `${m.item_code} is on a purchase order, so it stays on this production order.` }, 409);
  const { error } = await sb.from('production_order_materials').delete().eq('id', m.id);
  if (error) return c.json({ error: 'delete_failed', reason: error.message }, 500);
  return c.json({ ok: true });
});

/* Adds what the material list says for the order's works, for a list written after the PO was issued. */
productionOrders.post('/:id/apply-list', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const order = await loadOrder(sb, co.companyId, c.req.param('id'));
  if (!order) return c.json(NOT_THIS_COMPANY, 404);
  const { data, error } = await sb.rpc('production_apply_list', { p_order: order.id, p_lines: null });
  if (error) return c.json({ error: 'save_failed', reason: error.message }, 500);
  return c.json({ ok: true, added: Number(data ?? 0) });
});
