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
import { createDraftGrnsFromPoItemsCore, inHouseSupplierId, posWithProductionOrder, type GrnFromPoItemsContext } from '../lib/grn-from-po-core';
import { isOnSiteWarehouse } from '../lib/non-selling-warehouse';
import { callHandler } from './production-orders';
import { createDoFromSoLinesHandler, patchDeliveryOrderStatusHandler, soDeliverableRemaining } from './delivery-orders-mfg';
import { postGrnAndRollup, recordGrnCreate } from './grns';
import { addUp, deliveriesToRaise, receiptPicks } from '../lib/onsite-twin-rules';

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
    .select('id, purchase_order_id, so_item_id, qty, received_qty, po:purchase_orders!inner (po_number, status, supplier_id)').in('so_item_id', soItemIds);
  const inHouse = await inHouseSupplierId(sb, c);
  const rows = (data ?? []) as unknown as Array<{ id: string; purchase_order_id: string; so_item_id: string; qty: number; received_qty: number | null; po: { po_number: string; status: string; supplier_id: string } }>;
  /* Production Complete receives what it made; a Built-in PO to In-house has no order and is received like any other. */
  const made = await posWithProductionOrder(sb, rows.filter((l) => l.po.supplier_id === inHouse).map((l) => l.purchase_order_id));
  return rows.filter((l) => l.po.status !== 'CANCELLED' && l.po.status !== 'DRAFT' && !made.has(l.purchase_order_id));
}

const link = (sb: any, companyId: number, grnId: string, doId: string) =>
  sb.from('onsite_twins').upsert({ company_id: companyId, grn_id: grnId, do_id: doId }, { onConflict: 'grn_id,do_id', ignoreDuplicates: true });

/* One twin at a time per document: two presses at once would both read nothing done yet and both act. A claim left by a
   dead request lapses. Without the table the twin still runs, as it did before the claim existed. */
const CLAIM_TTL_MS = 2 * 60_000;
async function claimTwin(sb: any, docId: string, companyId: number): Promise<boolean> {
  await sb.from('onsite_twin_claims').delete().eq('doc_id', docId).lt('claimed_at', new Date(Date.now() - CLAIM_TTL_MS).toISOString());
  const { error } = await sb.from('onsite_twin_claims').insert({ doc_id: docId, company_id: companyId });
  if (error?.code === '23505') return false;
  if (error) console.error('[onsite-twin] claim failed:', error.message);
  return true;
}
const releaseTwin = (sb: any, docId: string) => sb.from('onsite_twin_claims').delete().eq('doc_id', docId);

/* What the receipts already tied to this delivery took, by SO line. */
async function receivedByTwins(sb: any, doId: string): Promise<Map<string, number>> {
  const { data } = await sb.from('onsite_twins').select('grn:grns!inner (status, grn_items (qty_accepted, qty_received, poi:purchase_order_items (so_item_id)))').eq('do_id', doId);
  const rows = ((data ?? []) as unknown as Array<{ grn: { status: string; grn_items: Array<{ qty_accepted: number | null; qty_received: number | null; poi: { so_item_id: string | null } | null }> } }>)
    .filter((t) => t.grn.status !== 'CANCELLED').flatMap((t) => t.grn.grn_items);
  return addUp(rows, (r) => r.poi?.so_item_id, (r) => Number(r.qty_accepted ?? r.qty_received ?? 0));
}

/* What the deliveries already tied to this receipt carry, by SO line. */
async function deliveredByTwins(sb: any, grnId: string): Promise<Map<string, number>> {
  const { data } = await sb.from('onsite_twins').select('dord:delivery_orders!inner (status, delivery_order_items (so_item_id, qty))').eq('grn_id', grnId);
  const rows = ((data ?? []) as unknown as Array<{ dord: { status: string; delivery_order_items: Array<{ so_item_id: string | null; qty: number }> } }>)
    .filter((t) => t.dord.status !== 'CANCELLED').flatMap((t) => t.dord.delivery_order_items);
  return addUp(rows, (r) => r.so_item_id, (r) => Number(r.qty ?? 0));
}

/* Draft deliveries planned for these SO lines, not yet tied to this receipt. */
async function draftDeliveries(sb: any, soItemIds: string[], grnId: string, companyId: number) {
  const { data: tiedRows } = await sb.from('onsite_twins').select('do_id').eq('grn_id', grnId);
  const tied = new Set(((tiedRows ?? []) as Array<{ do_id: string }>).map((t) => t.do_id));
  const { data } = await sb.from('delivery_order_items').select('so_item_id, qty, dord:delivery_orders!inner (id, status, company_id)').in('so_item_id', soItemIds);
  return ((data ?? []) as unknown as Array<{ so_item_id: string; qty: number; dord: { id: string; status: string; company_id: number } }>)
    .filter((l) => l.dord.status === 'DRAFT' && l.dord.company_id === companyId && !tied.has(l.dord.id))
    .map((l) => ({ doId: l.dord.id, soItemId: l.so_item_id, qty: Number(l.qty) }));
}

/* A posted GR at On-site delivers the lines it received. */
onsiteTwinGrn.post('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  if (!(await claimTwin(sb, id, co.companyId))) return c.json({ ok: true, raised: [], busy: true });
  try { return await deliverReceipt(c, sb, id, co.companyId); } finally { await releaseTwin(sb, id); }
});

async function deliverReceipt(c: any, sb: any, id: string, companyId: number) {
  const co = { companyId };
  const { data: g } = await sb.from('grns').select('id, grn_number, status, warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  const grn = g as { id: string; grn_number: string; status: string; warehouse_id: string | null } | null;
  if (!grn) return c.json({ error: 'not_found' }, 404);
  if (grn.status !== 'POSTED' || !(await onSiteIds(sb, [grn.warehouse_id], co.companyId)).size) return c.json({ ok: true, raised: [] });
  const { data: lines } = await sb.from('grn_items').select('qty_accepted, qty_received, poi:purchase_order_items!inner (so_item_id, purchase_order_id, po:purchase_orders!inner (supplier_id))').eq('grn_id', id);
  const inHouse = await inHouseSupplierId(sb, c);
  const got = new Map<string, number>();
  const received = (lines ?? []) as unknown as Array<{ qty_accepted: number | null; qty_received: number | null; poi: { so_item_id: string | null; purchase_order_id: string; po: { supplier_id: string } } }>;
  const made = await posWithProductionOrder(sb, received.filter((l) => l.poi.po.supplier_id === inHouse).map((l) => l.poi.purchase_order_id));
  for (const l of received) {
    if (!l.poi.so_item_id || made.has(l.poi.purchase_order_id)) continue;
    got.set(l.poi.so_item_id, (got.get(l.poi.so_item_id) ?? 0) + Number(l.qty_accepted ?? l.qty_received ?? 0));
  }
  if (got.size === 0) return c.json({ ok: true, raised: [] });
  const { data: so } = await sb.from('mfg_sales_order_items').select('id, doc_no').in('id', [...got.keys()]);
  const docOf = new Map(((so ?? []) as Array<{ id: string; doc_no: string }>).map((s) => [s.id, s.doc_no]));
  const remaining = await soDeliverableRemaining(sb, [...new Set(docOf.values())]);
  const plan = deliveriesToRaise(got, await deliveredByTwins(sb, id), await draftDeliveries(sb, [...got.keys()], id, co.companyId), (x) => Number(remaining.get(x)?.remaining ?? 0));
  for (const doId of plan.planned) await link(sb, co.companyId, grn.id, doId);
  const byDoc = new Map<string, Array<{ soItemId: string; qty: number }>>();
  for (const pick of plan.raise) {
    const doc = docOf.get(pick.soItemId);
    if (doc) byDoc.set(doc, [...(byDoc.get(doc) ?? []), pick]);
  }
  const raised: string[] = [];
  const problems: string[] = [];
  for (const picks of byDoc.values()) {
    const out = await callHandler(c, createDoFromSoLinesHandler as never, { picks, confirmShortStock: true, warehouseId: grn.warehouse_id ?? undefined });
    if (out.status >= 300 || !out.json.id) { problems.push(words(out.json, 'The delivery order could not be raised.')); continue; }
    const doId = String(out.json.id);
    await link(sb, co.companyId, grn.id, doId);
    const notMoved = out.json.movementErrors as string[] | undefined;
    if (notMoved?.length) problems.push(`The delivery order was raised but its stock did not move: ${notMoved.join('; ')}`);
    raised.push(String(out.json.doNumber ?? out.json.do_number ?? doId));
    const done = await callHandler(c, patchDeliveryOrderStatusHandler as never, { status: 'DELIVERED', confirmShortStock: true }, { id: doId });
    if (done.status >= 300) problems.push(words(done.json, 'The delivery order was raised but not marked delivered.'));
  }
  if (problems.length > 0) return c.json({ error: 'twin_failed', message: problems.join(' '), raised }, 409);
  return c.json({ ok: true, raised });
}

/* A confirmed DO on site receives what its lines' POs still have outstanding. */
onsiteTwinDo.post('/:id', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  if (!(await claimTwin(sb, id, co.companyId))) return c.json({ ok: true, raised: [], busy: true });
  try { return await receiveDelivery(c, sb, id, co.companyId); } finally { await releaseTwin(sb, id); }
});

async function receiveDelivery(c: any, sb: any, id: string, companyId: number) {
  const co = { companyId };
  const { data: d } = await sb.from('delivery_orders').select('id, do_number, status, warehouse_id').eq('id', id).eq('company_id', co.companyId).maybeSingle();
  const dord = d as { id: string; do_number: string; status: string; warehouse_id: string | null } | null;
  if (!dord) return c.json({ error: 'not_found' }, 404);
  if (dord.status === 'DRAFT' || dord.status === 'CANCELLED') return c.json({ ok: true, raised: [] });
  const lines = await onSiteDoLines(sb, id, dord.warehouse_id, co.companyId);
  const po = await poLinesFor(sb, c, lines.map((l) => l.so_item_id));
  const picks = receiptPicks(lines, po, await receivedByTwins(sb, id));
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
    const posted = await postGrnAndRollup(sb, draft.id, c.get('user').id, draft.companyId);
    if (!posted.ok) { problems.push(`The goods receipt was raised but not posted: ${posted.reason}`); continue; }
    if (posted.movementErrors?.length) problems.push(`The goods receipt posted but its stock did not move: ${posted.movementErrors.join('; ')}`);
    await recordGrnCreate(sb, c.get('houzsUser'), co.companyId, draft.id, draft.lineCount, `Received from ${draft.poNumbers.join(', ')} on confirming ${dord.do_number}`);
    await link(sb, co.companyId, draft.id, id);
    raised.push(draft.grnNumber ?? draft.id);
  }
  if (problems.length > 0) return c.json({ error: 'twin_failed', message: problems.join(' '), raised }, 409);
  return c.json({ ok: true, raised });
}

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
