/* One order's chain at a glance (owner, 7 Nov 2026): from any document, where the goods are. Sales order, PO, production
   order, goods receipt and delivery order with their status and dates. It reads numbers and dates only, no prices, so
   anyone who can open one of the documents may see the chain. Renovation orders only: a Houzs order answers nothing. */

import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { requireActiveCompanyId } from '../lib/companyScope';
import { soCoverage } from './mfg-sales-orders';
import { withListMemo } from '../lib/mrp-list-memo';

export const renovationDocTrail = new Hono<{ Bindings: Env; Variables: Variables }>();
renovationDocTrail.use('*', supabaseAuth);

type Db = { prepare: (q: string) => { bind: (...a: unknown[]) => { all: <T>() => Promise<{ results?: T[] }> } } };

export type TrailKind = 'so' | 'po' | 'production' | 'gr' | 'do';
export interface TrailRow { kind: TrailKind; id: string; no: string; status: string; on_hold: boolean | null; expected: string | null; started: string | null; done: string | null; who: string | null }
export interface TrailStep { kind: TrailKind; id: string; no: string; word: string; tone: 'done' | 'active' | 'wait' | 'stopped'; date: string | null; who: string | null }

const ORDER: readonly TrailKind[] = ['so', 'po', 'production', 'gr', 'do'];

/** The plain word for a document's state and the date that goes with it. */
export function stepOf(r: TrailRow): TrailStep {
  const base = { kind: r.kind, id: r.id, no: r.no, who: r.who };
  const s = r.status.toUpperCase();
  if (s.includes('CANCEL')) return { ...base, word: 'Cancelled', tone: 'stopped', date: null };
  if (r.on_hold) return { ...base, word: 'On hold', tone: 'stopped', date: null };
  if (r.kind === 'so') return { ...base, word: s === 'DRAFT' ? 'Draft' : 'Confirmed', tone: s === 'DRAFT' ? 'wait' : 'done', date: r.started };
  if (r.kind === 'po') {
    if (r.done) return { ...base, word: 'Received', tone: 'done', date: r.done };
    return { ...base, word: s === 'DRAFT' ? 'Draft' : 'Arrives', tone: s === 'DRAFT' ? 'wait' : 'active', date: r.expected };
  }
  if (r.kind === 'production') {
    if (r.done) return { ...base, word: 'Completed', tone: 'done', date: r.done };
    if (r.started) return { ...base, word: 'In progress, due', tone: 'active', date: r.expected };
    return { ...base, word: 'Not started, due', tone: 'wait', date: r.expected };
  }
  if (r.kind === 'gr') return { ...base, word: 'Received', tone: 'done', date: r.done };
  if (s === 'DRAFT') return { ...base, word: 'Draft delivery', tone: 'wait', date: r.expected };
  if (r.done) return { ...base, word: 'Delivered', tone: 'done', date: r.done };
  return { ...base, word: 'Confirmed, due', tone: 'active', date: r.expected };
}

export const trailOf = (rows: readonly TrailRow[]): TrailStep[] => [...rows]
  .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.no.localeCompare(b.no))
  .map(stepOf);

/* The SOs behind a document, then every document of those SOs. A PO can serve several SOs in bulk purchase, so a list. */
const ROOTS = `
  WITH picked AS (SELECT ?::text AS kind, ?::text AS id),
  roots AS (
    SELECT id AS doc_no FROM picked WHERE kind = 'so'
    UNION SELECT si.doc_no FROM picked p JOIN scm.purchase_order_items i ON p.kind = 'po' AND i.purchase_order_id::text = p.id JOIN scm.mfg_sales_order_items si ON si.id = i.so_item_id
    UNION SELECT si.doc_no FROM picked p JOIN scm.production_order_items i ON p.kind = 'production' AND i.production_order_id::text = p.id JOIN scm.mfg_sales_order_items si ON si.id = i.so_item_id
    UNION SELECT si.doc_no FROM picked p JOIN scm.grns g ON p.kind = 'gr' AND g.id::text = p.id JOIN scm.purchase_order_items i ON i.purchase_order_id = g.purchase_order_id JOIN scm.mfg_sales_order_items si ON si.id = i.so_item_id
    UNION SELECT d.so_doc_no FROM picked p JOIN scm.delivery_orders d ON p.kind = 'do' AND d.id::text = p.id
  ),
  sos AS (SELECT so.doc_no, so.status::text AS status, so.so_date, so.on_hold FROM scm.mfg_sales_orders so JOIN roots r ON r.doc_no = so.doc_no WHERE so.company_id = ? AND so.so_kind = 'RENOVATION'),
  items AS (SELECT si.id FROM scm.mfg_sales_order_items si JOIN sos ON sos.doc_no = si.doc_no),
  pos AS (SELECT DISTINCT po.id FROM scm.purchase_orders po JOIN scm.purchase_order_items i ON i.purchase_order_id = po.id JOIN items ON items.id = i.so_item_id)`;

/* Per sales order line, for the Transfer from Sales Order pickers (owner, 7 Nov 2026): its stock, and the PO,
   production order, GR and DO that hold it. A line with none of those shows the arrival date of the incoming stock
   it is counted against. */
export type LineStock = 'stock' | 'po' | 'shortage' | null;
export interface LineStatus { stock: LineStock; incomingPo: string | null; eta: string | null; steps: TrailStep[] }
type LineRow = TrailRow & { line: string };

export function lineStatuses(
  ids: readonly string[], rows: readonly LineRow[],
  cover: ReadonlyMap<string, { source?: string | null; po?: string | null; eta?: string | null }>,
): Record<string, LineStatus> {
  const out: Record<string, LineStatus> = {};
  for (const id of ids) {
    const c = cover.get(id);
    const source = c?.source === 'stock' || c?.source === 'po' || c?.source === 'shortage' ? c.source : null;
    out[id] = { stock: source, incomingPo: source === 'po' ? c?.po ?? null : null, eta: source === 'po' ? c?.eta ?? null : null, steps: trailOf(rows.filter((r) => r.line === id)) };
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

renovationDocTrail.get('/lines', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const ids = [...new Set((c.req.query('ids') ?? '').split(',').map((s) => s.trim()).filter((s) => UUID.test(s)))].slice(0, 400);
  if (ids.length === 0) return c.json({ lines: {} });
  const { results } = await (c.env.DB as unknown as Db).prepare(
    `WITH ids AS (SELECT unnest(string_to_array(?::text, ',')) AS id)
     SELECT i.so_item_id::text AS line, 'po' AS kind, po.id::text AS id, po.po_number AS no, po.status::text AS status, po.on_hold, po.expected_at::text AS expected, NULL::text AS started, po.received_at::text AS done, s.name AS who
       FROM scm.purchase_order_items i JOIN ids ON ids.id = i.so_item_id::text JOIN scm.purchase_orders po ON po.id = i.purchase_order_id AND po.company_id = ?
       LEFT JOIN scm.suppliers s ON s.id = po.supplier_id
     UNION
     SELECT i.so_item_id::text, 'production', o.id::text, o.po_number, o.status::text, o.on_hold, o.expected_at::text, o.actual_start_at::text, o.received_at::text, NULL
       FROM scm.production_order_items i JOIN ids ON ids.id = i.so_item_id::text JOIN scm.production_orders o ON o.id = i.production_order_id AND o.company_id = ?
     UNION
     SELECT pi.so_item_id::text, 'gr', g.id::text, g.grn_number, g.status::text, g.on_hold, NULL, NULL, g.received_at::text, NULL
       FROM scm.grn_items gi JOIN scm.purchase_order_items pi ON pi.id = gi.purchase_order_item_id JOIN ids ON ids.id = pi.so_item_id::text
       JOIN scm.grns g ON g.id = gi.grn_id JOIN scm.purchase_orders po ON po.id = g.purchase_order_id AND po.company_id = ?
     UNION
     SELECT di.so_item_id::text, 'do', d.id::text, d.do_number, d.status::text, d.on_hold, coalesce(d.customer_delivery_date, d.do_date)::text, NULL, d.delivered_at::text, NULL
       FROM scm.delivery_order_items di JOIN ids ON ids.id = di.so_item_id::text JOIN scm.delivery_orders d ON d.id = di.delivery_order_id
       JOIN scm.mfg_sales_orders so ON so.doc_no = d.so_doc_no AND so.company_id = ?`,
  ).bind(ids.join(','), co.companyId, co.companyId, co.companyId, co.companyId).all<LineRow>();
  // Stock is best effort: when the stock count fails the documents still show.
  /* The picker asks in pages; the whole-company stock count is the same for each page, so it is worked out once and
     reused for a few seconds (as the list screens do) instead of once per page. */
  const cov = await withListMemo(`doc-trail-lines:${co.companyId}`, () => soCoverage(c, c.get('supabase')));
  return c.json({ lines: lineStatuses(ids, results ?? [], cov.coverage as ReadonlyMap<string, { source?: string | null; po?: string | null; eta?: string | null }>) });
});

renovationDocTrail.get('/', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const kind = c.req.query('kind') ?? '';
  const id = c.req.query('id') ?? '';
  if (!(ORDER as readonly string[]).includes(kind) || !id) return c.json({ error: 'validation', message: 'Say which document.' }, 400);
  const { results } = await (c.env.DB as unknown as Db).prepare(
    `${ROOTS}
     SELECT 'so' AS kind, doc_no AS id, doc_no AS no, status, on_hold, NULL::text AS expected, so_date::text AS started, NULL::text AS done, NULL::text AS who FROM sos
     UNION ALL
     SELECT 'po', po.id::text, po.po_number, po.status::text, po.on_hold, po.expected_at::text, NULL, po.received_at::text, s.name
       FROM scm.purchase_orders po JOIN pos ON pos.id = po.id LEFT JOIN scm.suppliers s ON s.id = po.supplier_id
     UNION ALL
     SELECT DISTINCT 'production', o.id::text, o.po_number, o.status::text, o.on_hold, o.expected_at::text, o.actual_start_at::text, o.received_at::text, NULL
       FROM scm.production_orders o JOIN scm.production_order_items i ON i.production_order_id = o.id JOIN items ON items.id = i.so_item_id
     UNION ALL
     SELECT 'gr', g.id::text, g.grn_number, g.status::text, g.on_hold, NULL, NULL, g.received_at::text, NULL
       FROM scm.grns g JOIN pos ON pos.id = g.purchase_order_id
     UNION ALL
     SELECT 'do', d.id::text, d.do_number, d.status::text, d.on_hold, coalesce(d.customer_delivery_date, d.do_date)::text, NULL, d.delivered_at::text, NULL
       FROM scm.delivery_orders d JOIN sos ON sos.doc_no = d.so_doc_no`,
  ).bind(kind, id, co.companyId).all<TrailRow>();
  return c.json({ steps: trailOf(results ?? []) });
});
