// ----------------------------------------------------------------------------
// GET <document>/:id/renovation-info — what a renovation-mode DO, SI, PO or GR
// carries from upstream (owner, 14 Oct 2026, "batch 4"; migration 0116): its
// project, building and unit, the sales orders it came from, and each line's
// room (and, on a PO or GR, the product's category / sub-category).
//
// The copying itself is done by the 0116 triggers; this only reads it back for
// the document page and its print. One small router per document, mounted on
// that document's own prefix in scm/index.ts (the "new file, same prefix"
// pattern of delivery-order-item-photos.ts), so the document's area guard and
// company scope apply unchanged and no Houzs route file is edited.
//
// Answers { ready: false } outside renovation mode or before 0116 is applied;
// the pages then show nothing new.
// ----------------------------------------------------------------------------
import { Hono, type Context } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import { activeCompanySql } from '../lib/companyScope';
import type { Env, Variables } from '../env';
import type { Db } from '../../services/renovation/load';
import { renovationMode } from '../../services/renovation/customerProperty';

type C = Context<{ Bindings: Env; Variables: Variables }>;
export type RenoDocKind = 'do' | 'si' | 'po' | 'gr';

export interface RenoDocLine { room: string; categoryGroup: string; subCategory: string }
export interface RenoDocInfo {
  ready: boolean;
  info: {
    projectId: number | null;
    projectCode: string | null;
    projectName: string | null;
    building: string;
    unitNo: string;
    soDocNos: string[];
    poNumbers: string[];
    /** A renovation PO's one category (and sub-category while its lines share one); '' elsewhere. */
    categoryGroup: string;
    subCategory: string;
  } | null;
  lines: Record<string, RenoDocLine>;
}

const dbOf = (c: { env: Env }) => c.env.DB as unknown as Db;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const t = (v: unknown): string => (v == null ? '' : String(v));

let columnsKnown = false;
/** Migration 0116 is in this database (its last-added columns exist). */
export async function docFlowColumnsReady(db: Db): Promise<boolean> {
  if (columnsKnown) return true;
  const r = await db.prepare(
    `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'scm' AND table_name = 'delivery_orders' AND column_name = 'unit_no')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'scm' AND table_name = 'grn_items' AND column_name = 'sub_category')) AS ready`,
  ).bind().first<{ ready: boolean }>();
  columnsKnown = r?.ready === true;
  return columnsKnown;
}

/* Per kind: the header row (project, building, unit, its own SO link) and the lines (id, room, category). */
const NO_CAT = `NULL::text AS category_group, NULL::text AS sub_category`;
const SQL: Record<RenoDocKind, { head: (co: string) => string; lines: string; so: string; po: string | null }> = {
  do: {
    head: (co) => `SELECT project_id::int AS project_id, building, unit_no, so_doc_no, ${NO_CAT} FROM scm.delivery_orders WHERE id = ?::uuid${co}`,
    lines: `SELECT id::text AS id, room, NULL::text AS category_group, NULL::text AS sub_category FROM scm.delivery_order_items WHERE delivery_order_id = ?::uuid`,
    so: `SELECT DISTINCT i.doc_no FROM scm.delivery_order_items x JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id WHERE x.delivery_order_id = ?::uuid`,
    po: null,
  },
  si: {
    head: (co) => `SELECT project_id::int AS project_id, building, unit_no, so_doc_no, ${NO_CAT} FROM scm.sales_invoices WHERE id = ?::uuid${co}`,
    lines: `SELECT id::text AS id, room, NULL::text AS category_group, NULL::text AS sub_category FROM scm.sales_invoice_items WHERE sales_invoice_id = ?::uuid`,
    so: `SELECT DISTINCT i.doc_no FROM scm.sales_invoice_items x JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id WHERE x.sales_invoice_id = ?::uuid`,
    po: null,
  },
  po: {
    head: (co) => `SELECT project_id::int AS project_id, NULL::text AS building, NULL::text AS unit_no, NULL::text AS so_doc_no, category_group, sub_category FROM scm.purchase_orders WHERE id = ?::uuid${co}`,
    lines: `SELECT id::text AS id, room, category_group, sub_category FROM scm.purchase_order_items WHERE purchase_order_id = ?::uuid`,
    so: `SELECT DISTINCT i.doc_no FROM scm.purchase_order_items x JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id WHERE x.purchase_order_id = ?::uuid`,
    po: null,
  },
  gr: {
    head: (co) => `SELECT project_id::int AS project_id, NULL::text AS building, NULL::text AS unit_no, NULL::text AS so_doc_no, ${NO_CAT} FROM scm.grns WHERE id = ?::uuid${co}`,
    lines: `SELECT id::text AS id, room, category_group, sub_category FROM scm.grn_items WHERE grn_id = ?::uuid`,
    so: `SELECT DISTINCT i.doc_no FROM scm.grn_items g JOIN scm.purchase_order_items x ON x.id = g.purchase_order_item_id
           JOIN scm.mfg_sales_order_items i ON i.id = x.so_item_id WHERE g.grn_id = ?::uuid`,
    po: `SELECT DISTINCT po.po_number FROM scm.grn_items g JOIN scm.purchase_order_items x ON x.id = g.purchase_order_item_id
           JOIN scm.purchase_orders po ON po.id = x.purchase_order_id WHERE g.grn_id = ?::uuid`,
  },
};

export async function readRenoDocInfo(db: Db, kind: RenoDocKind, id: string, companySql: string): Promise<RenoDocInfo | null> {
  const q = SQL[kind];
  const head = await db.prepare(q.head(companySql)).bind(id).first<{ project_id: number | null; building: string | null; unit_no: string | null; so_doc_no: string | null; category_group: string | null; sub_category: string | null }>();
  if (!head) return null;
  const [lines, sos, pos] = await Promise.all([
    db.prepare(q.lines).bind(id).all<{ id: string; room: string | null; category_group: string | null; sub_category: string | null }>(),
    db.prepare(q.so).bind(id).all<{ doc_no: string }>(),
    q.po ? db.prepare(q.po).bind(id).all<{ po_number: string }>() : Promise.resolve({ results: [] as Array<{ po_number: string }> }),
  ]);
  const project = head.project_id == null ? null : await db.prepare(
    `SELECT code, name FROM projects WHERE id = ? AND project_kind = 'renovation'`,
  ).bind(head.project_id).first<{ code: string | null; name: string | null }>();
  const soDocNos = [...new Set([...(head.so_doc_no ? [head.so_doc_no] : []), ...(sos.results ?? []).map((r) => r.doc_no)])].sort();
  const out: RenoDocInfo = {
    ready: true,
    info: {
      projectId: project ? Number(head.project_id) : null, projectCode: project?.code ?? null, projectName: project?.name ?? null,
      building: t(head.building), unitNo: t(head.unit_no), soDocNos, poNumbers: (pos.results ?? []).map((r) => r.po_number).sort(),
      categoryGroup: t(head.category_group), subCategory: t(head.sub_category),
    },
    lines: {},
  };
  for (const l of lines.results ?? []) {
    out.lines[l.id] = { room: t(l.room), categoryGroup: t(l.category_group), subCategory: t(l.sub_category) };
  }
  return out;
}

function router(kind: RenoDocKind) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  /* The SCM bridge every sub-router declares; it runs once per request even though this router shares its
     prefix with the document's main router (middleware/auth.ts). */
  app.use('*', supabaseAuth);
  app.get('/:id/renovation-info', async (c: C) => {
    const db = dbOf(c);
    const id = c.req.param('id') ?? '';
    if (!UUID.test(id)) return c.json({ error: 'invalid_id' }, 400);
    const on = (await renovationMode(db).catch(() => false)) && (await docFlowColumnsReady(db).catch(() => false));
    if (!on) return c.json({ ready: false, info: null, lines: {} } satisfies RenoDocInfo);
    const out = await readRenoDocInfo(db, kind, id, activeCompanySql(c));
    if (!out) return c.json({ error: 'not_found' }, 404);
    return c.json(out);
  });
  return app;
}

export const renovationDoInfo = router('do');
export const renovationSiInfo = router('si');
export const renovationPoInfo = router('po');
export const renovationGrInfo = router('gr');
