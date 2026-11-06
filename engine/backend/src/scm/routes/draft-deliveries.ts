/* The phone's Draft delivery (owner, 7 Nov 2026): draft DOs as job cards for production workers. The stored status stays
   DRAFT. Behind the production area, not the delivery one, because these workers receive goods but do not run DOs. A DO
   leaves the list when it is confirmed. The PO a job shows comes from the real link, the line's SO line to its PO line. */

import { Hono } from 'hono';
import type { Env, Variables } from '../env';
import { supabaseAuth } from '../middleware/auth';
import { requireActiveCompanyId, scopeToCompanyId, NOT_THIS_COMPANY } from '../lib/companyScope';
import { callHandler } from './production-orders';
import { patchDeliveryOrderStatusHandler } from './delivery-orders-mfg';

export const draftDeliveries = new Hono<{ Bindings: Env; Variables: Variables }>();
draftDeliveries.use('*', supabaseAuth);

type Db = { prepare: (q: string) => { bind: (...a: unknown[]) => { all: <T>() => Promise<{ results?: T[] }> } } };

export interface DraftJobRow {
  id: string; do_number: string; due: string | null; time_range: string | null; building: string | null; unit_no: string | null;
  project_code: string | null; project_name: string | null; so_doc_no: string | null; items: unknown; pos: unknown;
}

export interface DraftJob {
  id: string; doNumber: string; due: string | null; time: string | null; place: string; projectCode: string | null; soDocNo: string | null;
  items: Array<{ code: string; description: string; qty: number; uom: string | null }>;
  pos: Array<{ poNumber: string; supplier: string | null }>;
}

const list = <T,>(v: unknown): T[] => {
  const raw = typeof v === 'string' ? JSON.parse(v) as unknown : v;
  return Array.isArray(raw) ? raw as T[] : [];
};

export function jobOf(r: DraftJobRow): DraftJob {
  const unit = [r.building, r.unit_no].filter(Boolean).join(' ');
  return {
    id: r.id, doNumber: r.do_number, due: r.due, time: r.time_range?.trim() || null, place: unit || r.project_name || r.so_doc_no || r.do_number,
    projectCode: r.project_code, soDocNo: r.so_doc_no, items: list(r.items), pos: list(r.pos),
  };
}

draftDeliveries.get('/', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const { results } = await (c.env.DB as unknown as Db).prepare(
    `SELECT d.id::text AS id, d.do_number, coalesce(d.customer_delivery_date, d.do_date)::text AS due, d.time_range,
            coalesce(nullif(trim(d.building), ''), p.building) AS building, coalesce(nullif(trim(d.unit_no), ''), p.unit_no) AS unit_no,
            p.code AS project_code, p.name AS project_name, d.so_doc_no,
            (SELECT coalesce(json_agg(json_build_object('code', i.item_code, 'description', coalesce(i.description, i.item_code), 'qty', i.qty, 'uom', i.uom) ORDER BY i.line_no NULLS LAST, i.id), '[]'::json)
               FROM scm.delivery_order_items i WHERE i.delivery_order_id = d.id) AS items,
            (SELECT coalesce(json_agg(DISTINCT jsonb_build_object('poNumber', po.po_number, 'supplier', s.name)), '[]'::json)
               FROM scm.delivery_order_items i
               JOIN scm.purchase_order_items pi ON pi.so_item_id = i.so_item_id
               JOIN scm.purchase_orders po ON po.id = pi.purchase_order_id AND po.status::text NOT IN ('DRAFT', 'CANCELLED')
               LEFT JOIN scm.suppliers s ON s.id = po.supplier_id
              WHERE i.delivery_order_id = d.id) AS pos
       FROM scm.delivery_orders d
       LEFT JOIN scm.mfg_sales_orders so ON so.doc_no = d.so_doc_no
       LEFT JOIN projects p ON p.id = coalesce(d.project_id, so.project_id)
      WHERE d.company_id = ? AND d.status::text = 'DRAFT'
      ORDER BY coalesce(d.customer_delivery_date, d.do_date) NULLS LAST, d.time_range NULLS LAST, d.do_number
      LIMIT 300`,
  ).bind(co.companyId).all<DraftJobRow>();
  return c.json({ jobs: (results ?? []).map(jobOf) });
});

/** What Mark complete sends, or why it may not go. */
export function completeProblem(b: { podKeys?: unknown; receivedBy?: unknown }): string | null {
  if (!Array.isArray(b.podKeys) || b.podKeys.length === 0) return 'Add at least one photo.';
  if (typeof b.receivedBy !== 'string' || !b.receivedBy.trim()) return 'Say who received the goods.';
  return null;
}

/* Mark complete confirms the draft: stock moves, POD and Received by stay on the DO, and a DO straight to site raises its GR
   with the same POD, through the status route every other confirm takes. A second press finds it confirmed and does nothing. */
draftDeliveries.post('/:id/complete', async (c) => {
  const co = requireActiveCompanyId(c);
  if (!co.ok) return c.json(co.refusal, 409);
  const sb = c.get('supabase');
  const id = c.req.param('id');
  const b = (await c.req.json().catch(() => ({}))) as { podKeys?: unknown; receivedBy?: unknown; confirmShortStock?: boolean };
  const { data } = await scopeToCompanyId(sb.from('delivery_orders').select('status').eq('id', id), co.companyId).maybeSingle();
  const status = (data as { status?: string } | null)?.status;
  if (!status) return c.json(NOT_THIS_COMPANY, 404);
  if (status !== 'DRAFT') return c.json({ ok: true, already: true, status });
  const problem = completeProblem(b);
  if (problem) return c.json({ error: 'validation', message: problem }, 422);
  const out = await callHandler(c, patchDeliveryOrderStatusHandler, { status: 'LOADED', podKeys: b.podKeys, receivedBy: b.receivedBy, confirmShortStock: b.confirmShortStock === true }, { id });
  return c.json(out.json, out.status as 200);
});
