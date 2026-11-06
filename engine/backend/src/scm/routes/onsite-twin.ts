/* On-site, a receipt and a delivery are one event (owner, 6 Nov 2026): goods sent straight to the project are received
   and delivered together, tied by the SO line the PO was raised for. Whichever is confirmed first raises the other:
   - a posted GR at the On-site warehouse delivers the SO lines its PO lines were raised for;
   - a confirmed DO for On-site lines receives the PO lines raised for them.
   Both answer by what is still outstanding, so a repeat or the other side's sync finds nothing to do.

   A separate request from the confirm on purpose: the free Workers plan allows 50 outside calls per request, and this
   must never fail the receipt or delivery that was just confirmed. An in-house PO is left out: only completing its
   production order receives it. */

import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { requireActiveCompanyId } from '../lib/companyScope';
import { createDraftGrnsFromPoItemsCore, inHouseSupplierId, type GrnFromPoItemsContext } from '../lib/grn-from-po-core';
import { isOnSiteWarehouse } from '../lib/non-selling-warehouse';
import { callHandler } from './production-orders';
import { createDoFromSoLinesHandler, patchDeliveryOrderStatusHandler, soDeliverableRemaining } from './delivery-orders-mfg';
import { postGrnAndRollup, recordGrnCreate } from './grns';

/* eslint-disable @typescript-eslint/no-explicit-any -- the same loosely typed client and context as production-orders.ts */

/* Two routers, one area each: a GR's twin sits behind the GR gate, a DO's behind the DO gate. */
export const onsiteTwinGrn = new Hono<{ Bindings: Env; Variables: Variables }>();
export const onsiteTwinDo = new Hono<{ Bindings: Env; Variables: Variables }>();
onsiteTwinGrn.use('*', supabaseAuth);
onsiteTwinDo.use('*', supabaseAuth);

const words = (j: Record<string, unknown>, fallback: string): string => String(j.message ?? j.reason ?? j.error ?? fallback);

async function onSiteIds(sb: any, ids: Array<string | null>, companyId: number): Promise<Set<string>> {
  const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (wanted.length === 0) return new Set();
  const { data } = await sb.from('warehouses').select('id, code').in('id', wanted).eq('company_id', companyId);
  return new Set(((data ?? []) as Array<{ id: string; code: string | null }>).filter((w) => isOnSiteWarehouse(w.code)).map((w) => w.id));
}

/* The SO lines of a delivery that go on site: the delivery's own warehouse, or the line's. */
async function onSiteDoLines(sb: any, doId: string, doWarehouseId: string | null, companyId: number) {
  const { data: lines } = await sb.from('delivery_order_items').select('so_item_id, qty').eq('delivery_order_id', doId).not('so_item_id', 'is', null);
  const rows = (lines ?? []) as Array<{ so_item_id: string; qty: number }>;
  if (rows.length === 0) return [];
  const { data: so } = await sb.from('mfg_sales_order_items').select('id, warehouse_id').in('id', rows.map((r) => r.so_item_id));
  const whOf = new Map(((so ?? []) as Array<{ id: string; warehouse_id: string | null }>).map((s) => [s.id, s.warehouse_id]));
  const onSite = await onSiteIds(sb, [doWarehouseId, ...whOf.values()], companyId);
  return rows.filter((r) => (doWarehouseId && onSite.has(doWarehouseId)) || onSite.has(whOf.get(r.so_item_id) ?? ''));
}

async function poLinesFor(sb: any, c: any, soItemIds: string[]) {
  if (soItemIds.length === 0) return [];
  const { data } = await sb.from('purchase_order_items')
    .select('id, so_item_id, qty, received_qty, po:purchase_orders!inner (po_number, status, supplier_id)').in('so_item_id', soItemIds);
  const inHouse = await inHouseSupplierId(sb, c);
  return ((data ?? []) as unknown as Array<{ id: string; so_item_id: string; qty: number; received_qty: number | null; po: { po_number: string; status: string; supplier_id: string } }>)
    .filter((l) => l.po.status !== 'CANCELLED' && l.po.status !== 'DRAFT' && l.po.supplier_id !== inHouse);
}

const link = (sb: any, companyId: number, grnId: string, doId: string) =>
  sb.from('onsite_twins').upsert({ company_id: companyId, grn_id: grnId, do_id: doId }, { onConflict: 'grn_id,do_id', ignoreDuplicates: true });

/* A posted GR at On-site delivers the lines it received. */
onsiteTwinGrn.post('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: g } = await sb.from('grns').select('id, grn_number, status, warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  const grn = g as { id: string; grn_number: string; status: string; warehouse_id: string | null } | null;
  if (!grn) return c.json({ error: 'not_found' }, 404);
  if (grn.status !== 'POSTED' || !(await onSiteIds(sb, [grn.warehouse_id], co.companyId)).size) return c.json({ ok: true, raised: [] });
  const { data: lines } = await sb.from('grn_items').select('qty_accepted, qty_received, poi:purchase_order_items!inner (so_item_id, po:purchase_orders!inner (supplier_id))').eq('grn_id', id);
  const inHouse = await inHouseSupplierId(sb, c);
  const got = new Map<string, number>();
  for (const l of (lines ?? []) as unknown as Array<{ qty_accepted: number | null; qty_received: number | null; poi: { so_item_id: string | null; po: { supplier_id: string } } }>) {
    if (!l.poi.so_item_id || l.poi.po.supplier_id === inHouse) continue;
    got.set(l.poi.so_item_id, (got.get(l.poi.so_item_id) ?? 0) + Number(l.qty_accepted ?? l.qty_received ?? 0));
  }
  if (got.size === 0) return c.json({ ok: true, raised: [] });
  const { data: so } = await sb.from('mfg_sales_order_items').select('id, doc_no').in('id', [...got.keys()]);
  const docOf = new Map(((so ?? []) as Array<{ id: string; doc_no: string }>).map((s) => [s.id, s.doc_no]));
  const remaining = await soDeliverableRemaining(sb, [...new Set(docOf.values())]);
  const byDoc = new Map<string, Array<{ soItemId: string; qty: number }>>();
  for (const [soItemId, qty] of got) {
    const left = Math.min(qty, Number(remaining.get(soItemId)?.remaining ?? 0));
    const doc = docOf.get(soItemId);
    if (left > 0 && doc) byDoc.set(doc, [...(byDoc.get(doc) ?? []), { soItemId, qty: left }]);
  }
  const raised: string[] = [];
  const problems: string[] = [];
  for (const picks of byDoc.values()) {
    const out = await callHandler(c, createDoFromSoLinesHandler as never, { picks, confirmShortStock: true, warehouseId: grn.warehouse_id ?? undefined });
    if (out.status >= 300 || !out.json.id) { problems.push(words(out.json, 'The delivery order could not be raised.')); continue; }
    const doId = String(out.json.id);
    await link(sb, co.companyId, grn.id, doId);
    raised.push(String(out.json.doNumber ?? out.json.do_number ?? doId));
    const done = await callHandler(c, patchDeliveryOrderStatusHandler as never, { status: 'DELIVERED' }, { id: doId });
    if (done.status >= 300) problems.push(words(done.json, 'The delivery order was raised but not marked delivered.'));
  }
  if (problems.length > 0) return c.json({ error: 'twin_failed', message: problems.join(' '), raised }, 409);
  return c.json({ ok: true, raised });
});

/* A confirmed DO on site receives what its lines' POs still have outstanding. */
onsiteTwinDo.post('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: d } = await sb.from('delivery_orders').select('id, do_number, status, warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  const dord = d as { id: string; do_number: string; status: string; warehouse_id: string | null } | null;
  if (!dord) return c.json({ error: 'not_found' }, 404);
  if (dord.status === 'DRAFT' || dord.status === 'CANCELLED') return c.json({ ok: true, raised: [] });
  const lines = await onSiteDoLines(sb, id, dord.warehouse_id, co.companyId);
  const po = await poLinesFor(sb, c, lines.map((l) => l.so_item_id));
  const picks: Array<{ poItemId: string; qty: number }> = [];
  for (const l of lines) {
    let need = Number(l.qty);
    for (const p of po.filter((x) => x.so_item_id === l.so_item_id)) {
      const open = Number(p.qty) - Number(p.received_qty ?? 0) - picks.filter((x) => x.poItemId === p.id).reduce((t, x) => t + x.qty, 0);
      const qty = Math.min(need, open);
      if (qty > 0) { picks.push({ poItemId: p.id, qty }); need -= qty; }
    }
  }
  if (picks.length === 0) return c.json({ ok: true, raised: [] });
  const core = await createDraftGrnsFromPoItemsCore({
    req: { json: async () => ({ picks, notes: `Received on site with ${dord.do_number}` }) },
    get: ((key: string) => c.get(key as 'supabase')) as unknown as GrnFromPoItemsContext['get'],
  });
  if (!core.ok) return c.json({ error: 'twin_failed', message: words(core.body, 'The goods receipt could not be raised.') }, 409);
  const raised: string[] = [];
  const problems: string[] = [];
  for (const draft of core.created) {
    await sb.from('grns').update({ warehouse_id: dord.warehouse_id ?? undefined }).eq('id', draft.id).eq('status', 'DRAFT');
    await sb.from('grn_items').update({ zero_cost_ack: true, zero_cost_reason: `Received on site with ${dord.do_number}`, zero_cost_ack_by: c.get('user').id, zero_cost_ack_at: new Date().toISOString() })
      .eq('grn_id', draft.id).eq('unit_price_sen', 0);
    const posted = await postGrnAndRollup(sb, draft.id, c.get('user').id, draft.companyId, 'DRAFT');
    if (!posted.ok) { problems.push(`The goods receipt was raised but not posted: ${posted.reason}`); continue; }
    await recordGrnCreate(sb, c.get('houzsUser'), co.companyId, draft.id, draft.lineCount, `Received from ${draft.poNumbers.join(', ')} on confirming ${dord.do_number}`);
    await link(sb, co.companyId, draft.id, id);
    raised.push(draft.grnNumber ?? draft.id);
  }
  if (problems.length > 0) return c.json({ error: 'twin_failed', message: problems.join(' '), raised }, 409);
  return c.json({ ok: true, raised });
});

/* What the detail page shows: which PO a delivery goes with, and the twins raised so far. */
onsiteTwinDo.get('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: d } = await sb.from('delivery_orders').select('warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  if (!d) return c.json({ error: 'not_found' }, 404);
  const lines = await onSiteDoLines(sb, id, (d as { warehouse_id: string | null }).warehouse_id, co.companyId);
  const po = await poLinesFor(sb, c, lines.map((l) => l.so_item_id));
  const { data: twins } = await sb.from('onsite_twins').select('grn:grns!inner (id, grn_number)').eq('do_id', id);
  return c.json({
    onSite: lines.length > 0,
    pos: [...new Set(po.map((p) => p.po.po_number))],
    open: po.some((p) => Number(p.qty) > Number(p.received_qty ?? 0)),
    linked: ((twins ?? []) as unknown as Array<{ grn: { id: string; grn_number: string } }>).map((t) => ({ id: t.grn.id, no: t.grn.grn_number })),
  });
});

onsiteTwinGrn.get('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const { data: g } = await sb.from('grns').select('warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  if (!g) return c.json({ error: 'not_found' }, 404);
  const onSite = (await onSiteIds(sb, [(g as { warehouse_id: string | null }).warehouse_id], co.companyId)).size > 0;
  const { data: twins } = await sb.from('onsite_twins').select('dord:delivery_orders!inner (id, do_number)').eq('grn_id', id);
  return c.json({ onSite, linked: ((twins ?? []) as unknown as Array<{ dord: { id: string; do_number: string } }>).map((t) => ({ id: t.dord.id, no: t.dord.do_number })) });
});
