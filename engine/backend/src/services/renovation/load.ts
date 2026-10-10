/* Reads everything the renovation board and project detail need, set-based:
   about a dozen queries for any number of projects, through env.DB (Hyperdrive),
   so the free Workers plan's 50 outside calls per request is never in reach.

   Phase 2 (sales documents) builds in parallel and its tables may not exist yet:
     - scm.reno_doc_lines / reno_doc_sections missing (42P01) -> lines = null:
       nothing is auto-skipped and the board conditions read "not available".
     - scm.reno_doc_instalments / reno_instalment_bills missing -> billing
       not available: no prompts, and the hardware gate stays CLOSED.
   Phase 2's column names are read through to_jsonb(row)->>'col', so a column
   that is named differently reads as null instead of failing the whole page.
   Any other read error is thrown: the route answers 409 and no gate opens. */

import { categoryGroupOf, isCatalogGroup, type CatalogGroup } from "../../scm/shared/renovation-catalog";
import type { BillingFacts, InstalmentFact } from "./billing";
import { normTrigger } from "./billing";
import type { LineSupply } from "./conditions";
import type { LinePod } from "./pod";
import type { ContractLine, StoredStage } from "./stages";

export interface DbStmt {
  bind(...args: unknown[]): DbStmt;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Db {
  prepare(sql: string): DbStmt;
  batch?(stmts: DbStmt[]): Promise<unknown[]>;
}

export function isMissingRelation(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === "42P01" || /relation .* does not exist/i.test(String(err?.message ?? ""));
}

const ids = (xs: ReadonlyArray<string | number>) => JSON.stringify(xs.map(String));

async function rows<T>(db: Db, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<T>();
  return (res.results ?? []) as T[];
}

export interface ProjectRow {
  id: number;
  code: string | null;
  name: string;
  company_id: number;
  project_kind: string;
  project_type_id: number | null;
  customer_kind: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  pos_owner_id: string | null;
  pos_unit_id: string | null;
  building: string | null;
  unit_no: string | null;
  site_address: string | null;
  reno_stage: string | null;
  signed_at: string | null;
  planned_handover_date: string | null;
  handed_over_at: string | null;
  closed_at: string | null;
  salesperson_name: string | null;
  pic_id: number | null;
  notes: string | null;
  created_at: string | null;
  archived_at: string | null;
}

export const PROJECT_COLS =
  "p.id, p.code, p.name, p.company_id, p.project_kind, p.project_type_id, p.customer_kind, p.customer_id::text AS customer_id, " +
  "p.customer_name, p.customer_phone, p.customer_email, p.pos_owner_id, p.pos_unit_id, p.building, p.unit_no, p.site_address, " +
  "p.reno_stage, p.signed_at, p.planned_handover_date::text AS planned_handover_date, p.handed_over_at, p.closed_at, " +
  "p.salesperson_name, p.pic_id, p.notes, p.created_at, p.archived_at";

export interface TypeRow { id: number; slug: string; name: string; stage_keys: string[]; checklist_template_id: number | null }

export interface ChecklistRow {
  id: number;
  project_id: number;
  section_id: number | null;
  stage_key: string | null;
  seq: number;
  title: string;
  status: string;
  item_key: string | null;
  evidence_hint: string | null;
  skippable: boolean;
  skip_reason: string | null;
  skipped_by: number | null;
  skipped_at: string | null;
  completed_at: string | null;
  completed_by: number | null;
  evidence_r2_key: string | null;
  notes: string | null;
}

export interface SoRow {
  doc_no: string;
  project_id: number;
  status: string;
  so_date: string | null;
  agent: string | null;
  local_total_sen: number | null;
  so_kind: string | null;
}

export interface RawLine extends ContractLine {
  omitted: boolean;
  soDocNo: string;
  supplierId: string | null;
}

export interface PoLineRow {
  id: string;
  so_item_id: string;
  purchase_order_id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string | null;
  qty: number;
  received_qty: number;
  po_status: string;
}

export interface TaskRow {
  id: number;
  project_id: number;
  stage_key: string;
  trade_code: string;
  fix_phase: string;
  label: string;
  seq: number;
  fulfilment_kind: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  state: string;
  skip_reason: string | null;
  skip_source: string | null;
  skipped_at: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  done_at: string | null;
  completed_by_grn_id: string | null;
  notes: string | null;
}

export interface TaskLineRow { task_id: number; so_item_id: string; purchase_order_item_id: string | null }
export interface HandoverRow { project_id: number; customer_signer_name: string; signed_at: string; keys_returned: number | null; access_cards_returned: number | null; deposit_refund_note: string | null }
export interface DefectRow { id: number; project_id: number; phase: string; stage_key: string | null; location: string | null; item_description: string | null; reason: string | null; photo_r2_key: string | null; due_date: string | null; closed_at: string | null; reported_at: string | null }

export interface ProjectFacts {
  project: ProjectRow;
  type: TypeRow | null;
  stored: StoredStage[];
  checklist: ChecklistRow[];
  so: SoRow | null;
  /** live lines (not omitted); null when there is no renovation SO or lines cannot be read */
  lines: ContractLine[] | null;
  /** every ITEM/CHILD line including VO-omitted ones (trade tasks need omissions) */
  allLines: RawLine[] | null;
  linesUnavailable: "no_so" | "table_missing" | null;
  poLines: PoLineRow[];
  supply: Map<string, LineSupply>;
  pods: Map<string, LinePod>;
  billing: BillingFacts;
  tasks: TaskRow[];
  taskLines: TaskLineRow[];
  handover: HandoverRow | null;
  defects: DefectRow[];
}

export interface LoadOptions {
  /** Only the checklist rows the board needs (by item_key) instead of all. */
  checklistKeys?: readonly string[];
}

const BOARD_CHECKLIST_KEYS = ["keys_collected", "keys_returned", "renovation_permit", "shop_drawings_signed", "handover_signed"];

export async function loadProjectRows(db: Db, companySql: string, opts: { projectId?: number; includeArchived?: boolean } = {}): Promise<ProjectRow[]> {
  const where = [`p.project_kind = 'renovation'`];
  const args: unknown[] = [];
  if (opts.projectId != null) { where.push("p.id = ?"); args.push(opts.projectId); }
  if (!opts.includeArchived) where.push("p.archived_at IS NULL");
  const list = await rows<ProjectRow>(db, `SELECT ${PROJECT_COLS} FROM projects p WHERE ${where.join(" AND ")}${companySql} ORDER BY p.id DESC`, ...args);
  /* bigint columns arrive as strings from postgres.js; every map below keys on numbers. */
  const num = (x: unknown) => (x == null ? null : Number(x));
  return list.map((p) => ({ ...p, id: Number(p.id), company_id: Number(p.company_id), project_type_id: num(p.project_type_id), pic_id: num(p.pic_id) }));
}

export async function loadRenovationFacts(db: Db, projects: readonly ProjectRow[], opts: LoadOptions = {}): Promise<Map<number, ProjectFacts>> {
  const out = new Map<number, ProjectFacts>();
  if (projects.length === 0) return out;
  const pids = projects.map((p) => p.id);
  const typeIds = [...new Set(projects.map((p) => p.project_type_id).filter((x): x is number => x != null))];
  const keys = opts.checklistKeys ?? null;

  const [types, stages, checklist, sos, tasks, taskLines, handovers, defects] = await Promise.all([
    typeIds.length
      ? rows<TypeRow>(db, `SELECT id::int AS id, slug, name, to_json(stage_keys) AS stage_keys, checklist_template_id::int AS checklist_template_id FROM project_types WHERE id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`, ids(typeIds))
      : Promise.resolve([] as TypeRow[]),
    rows<StoredStage & { project_id: number }>(db,
      `SELECT project_id::int AS project_id, stage_key, state, skip_reason, skipped_by::int AS skipped_by, skipped_at, started_at, started_by::int AS started_by, done_at, done_by::int AS done_by,
              planned_start::text AS planned_start, planned_end::text AS planned_end
         FROM project_stages WHERE project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`, ids(pids)),
    rows<ChecklistRow>(db,
      `SELECT ck.id::int AS id, ck.project_id::int AS project_id, ck.section_id::int AS section_id, s.stage_key, ck.seq::int AS seq, ck.title, ck.status, ck.item_key, ck.evidence_hint,
              ck.skippable, ck.skip_reason, ck.skipped_by::int AS skipped_by, ck.skipped_at, ck.completed_at, ck.completed_by::int AS completed_by, ck.evidence_r2_key, ck.notes
         FROM project_checklist ck
         LEFT JOIN project_checklist_sections s ON s.id = ck.section_id
        WHERE ck.project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
          ${keys ? "AND ck.item_key IN (SELECT jsonb_array_elements_text(?::text::jsonb))" : ""}
        ORDER BY ck.project_id, s.sort_order NULLS LAST, ck.seq`,
      ...(keys ? [ids(pids), JSON.stringify(keys)] : [ids(pids)])),
    rows<SoRow>(db,
      `SELECT so.doc_no, so.project_id::int AS project_id, so.status::text AS status, so.so_date::text AS so_date, so.agent, so.local_total_sen,
              to_jsonb(so)->>'so_kind' AS so_kind
         FROM scm.mfg_sales_orders so
        WHERE so.project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::int)
          AND so.status::text <> 'CANCELLED'`, ids(pids)),
    rows<TaskRow>(db,
      `SELECT t.id::int AS id, t.project_id::int AS project_id, t.stage_key, t.trade_code, t.fix_phase, t.label, t.seq, t.fulfilment_kind,
              t.supplier_id::text AS supplier_id, sup.name AS supplier_name, t.purchase_order_id::text AS purchase_order_id, po.po_number,
              t.state, t.skip_reason, t.skip_source, t.skipped_at, t.planned_start::text AS planned_start, t.planned_end::text AS planned_end,
              t.actual_start::text AS actual_start, t.actual_end::text AS actual_end, t.done_at, t.completed_by_grn_id::text AS completed_by_grn_id, t.notes
         FROM project_trade_tasks t
         LEFT JOIN scm.suppliers sup ON sup.id = t.supplier_id
         LEFT JOIN scm.purchase_orders po ON po.id = t.purchase_order_id
        WHERE t.project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
        ORDER BY t.project_id, t.seq, t.id`, ids(pids)),
    rows<TaskLineRow>(db,
      `SELECT l.task_id::int AS task_id, l.so_item_id::text AS so_item_id, l.purchase_order_item_id::text AS purchase_order_item_id
         FROM project_trade_task_lines l JOIN project_trade_tasks t ON t.id = l.task_id
        WHERE t.project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`, ids(pids)),
    rows<HandoverRow>(db,
      `SELECT project_id::int AS project_id, customer_signer_name, signed_at, keys_returned, access_cards_returned, deposit_refund_note
         FROM project_handovers WHERE project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`, ids(pids)),
    rows<DefectRow>(db,
      `SELECT id::int AS id, project_id::int AS project_id, phase, stage_key, location, item_description, reason, photo_r2_key, due_date::text AS due_date, closed_at, reported_at
         FROM project_defects
        WHERE project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint) AND archived_at IS NULL
        ORDER BY id`, ids(pids)),
  ]);

  /* One live renovation SO per project (phase 2's uq_mfg_so_reno_project). An SO
     without so_kind = RENOVATION is a furniture order and never drives stages. */
  const soByProject = new Map<number, SoRow>();
  for (const so of sos) if (so.so_kind === "RENOVATION") soByProject.set(Number(so.project_id), so);
  const docNos = [...soByProject.values()].map((s) => s.doc_no);

  const [lineRes, poLines, doRows, siteRows, billingByDoc] = await Promise.all([
    loadContractLines(db, docNos),
    docNos.length
      ? rows<PoLineRow>(db,
          `SELECT poi.id::text AS id, poi.so_item_id::text AS so_item_id, poi.purchase_order_id::text AS purchase_order_id, po.po_number,
                  po.supplier_id::text AS supplier_id, sup.name AS supplier_name, poi.qty, poi.received_qty, po.status::text AS po_status
             FROM scm.purchase_order_items poi
             JOIN scm.purchase_orders po ON po.id = poi.purchase_order_id
             LEFT JOIN scm.suppliers sup ON sup.id = po.supplier_id
             JOIN scm.mfg_sales_order_items i ON i.id = poi.so_item_id
            WHERE i.doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb)) AND po.status::text <> 'CANCELLED'`, ids(docNos))
      : Promise.resolve([] as PoLineRow[]),
    docNos.length
      ? rows<{ so_item_id: string; qty: number; pod: boolean }>(db,
          `SELECT doi.so_item_id::text AS so_item_id, SUM(doi.qty)::int AS qty,
                  bool_or(d.pod_r2_key IS NOT NULL OR d.signature_data IS NOT NULL) AS pod
             FROM scm.delivery_order_items doi JOIN scm.delivery_orders d ON d.id = doi.delivery_order_id
            WHERE d.so_doc_no IN (SELECT jsonb_array_elements_text(?::text::jsonb))
              AND d.status::text IN ('SIGNED', 'DELIVERED', 'INVOICED') AND doi.so_item_id IS NOT NULL
            GROUP BY doi.so_item_id`, ids(docNos))
      : Promise.resolve([] as Array<{ so_item_id: string; qty: number; pod: boolean }>),
    rows<{ so_item_id: string; qty: number }>(db,
      `SELECT poi.so_item_id::text AS so_item_id, SUM(gi.qty_accepted)::int AS qty
         FROM scm.grn_items gi
         JOIN scm.grns g ON g.id = gi.grn_id
         JOIN scm.purchase_order_items poi ON poi.id = gi.purchase_order_item_id
        WHERE g.project_id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)
          AND g.received_at_site AND g.status::text NOT IN ('CANCELLED', 'DRAFT') AND poi.so_item_id IS NOT NULL
        GROUP BY poi.so_item_id`, ids(pids)),
    loadBilling(db, [...soByProject.values()]),
  ]);

  const supply = new Map<string, LineSupply>();
  for (const pl of poLines) {
    const s = supply.get(pl.so_item_id) ?? { orderedQty: 0, receivedQty: 0, deliveredQty: 0 };
    s.orderedQty += Number(pl.qty ?? 0);
    s.receivedQty += Number(pl.received_qty ?? 0);
    supply.set(pl.so_item_id, s);
  }
  const pods = new Map<string, LinePod>();
  for (const d of doRows) {
    const s = supply.get(d.so_item_id) ?? { orderedQty: 0, receivedQty: 0, deliveredQty: 0 };
    s.deliveredQty += Number(d.qty ?? 0);
    supply.set(d.so_item_id, s);
    const p = pods.get(d.so_item_id) ?? { siteQty: 0, doPodQty: 0 };
    if (d.pod) p.doPodQty += Number(d.qty ?? 0);
    pods.set(d.so_item_id, p);
  }
  for (const r of siteRows) {
    const p = pods.get(r.so_item_id) ?? { siteQty: 0, doPodQty: 0 };
    p.siteQty += Number(r.qty ?? 0);
    pods.set(r.so_item_id, p);
  }

  const typeById = new Map(types.map((t) => [Number(t.id), t]));
  for (const project of projects) {
    const so = soByProject.get(project.id) ?? null;
    const all = so && lineRes.lines ? lineRes.lines.filter((l) => l.soDocNo === so.doc_no) : null;
    const soItemIds = new Set(all?.map((l) => l.soItemId) ?? []);
    out.set(project.id, {
      project,
      type: project.project_type_id != null ? (typeById.get(Number(project.project_type_id)) ?? null) : null,
      stored: stages.filter((s) => Number(s.project_id) === project.id),
      checklist: checklist.filter((c) => Number(c.project_id) === project.id),
      so,
      allLines: all,
      lines: all ? all.filter((l) => !l.omitted) : null,
      linesUnavailable: !so ? "no_so" : lineRes.lines ? null : "table_missing",
      poLines: poLines.filter((pl) => soItemIds.has(pl.so_item_id)),
      supply,
      pods,
      billing: so ? (billingByDoc.get(so.doc_no) ?? { available: false, unavailableReason: "table_missing", contractSen: null, instalments: [] })
        : { available: false, unavailableReason: "no_so", contractSen: null, instalments: [] },
      tasks: tasks.filter((t) => Number(t.project_id) === project.id),
      taskLines: taskLines.filter((tl) => tasks.some((t) => Number(t.id) === Number(tl.task_id) && Number(t.project_id) === project.id)),
      handover: handovers.find((h) => Number(h.project_id) === project.id) ?? null,
      defects: defects.filter((d) => Number(d.project_id) === project.id),
    });
  }
  return out;
}

export { BOARD_CHECKLIST_KEYS };

interface LineDbRow {
  j: Record<string, unknown>;
  so_item_id: string;
  doc_no: string;
  qty: number;
  item_code: string | null;
  description: string | null;
  location: string | null;
  category: string | null;
  category_group: string | null;
  sub_category: string | null;
}

/** Contract lines per the integration contract: reno_doc_lines (owner SO, kind ITEM/CHILD)
    joined to live SO items and their products. VO-omitted lines are returned flagged. */
export async function loadContractLines(db: Db, docNos: readonly string[]): Promise<{ lines: RawLine[] | null }> {
  if (docNos.length === 0) return { lines: [] };
  let res: LineDbRow[];
  try {
    res = await rows<LineDbRow>(db,
      `WITH secs AS (
         SELECT s.id::text AS sid, to_jsonb(s)->>'so_doc_no' AS doc_no
           FROM scm.reno_doc_sections s
          WHERE to_jsonb(s)->>'so_doc_no' IN (SELECT jsonb_array_elements_text(?::text::jsonb))
       )
       SELECT to_jsonb(l) AS j, i.id::text AS so_item_id, secs.doc_no, i.qty, i.item_code, i.description, i.location,
              p.category::text AS category, to_jsonb(p)->>'category_group' AS category_group, to_jsonb(p)->>'sub_category' AS sub_category
         FROM scm.reno_doc_lines l
         JOIN secs ON secs.sid = to_jsonb(l)->>'section_id'
         JOIN scm.mfg_sales_order_items i ON i.id::text = to_jsonb(l)->>'so_item_id' AND i.cancelled = false
         LEFT JOIN LATERAL (SELECT * FROM scm.mfg_products mp WHERE mp.code = i.item_code ORDER BY mp.company_id = i.company_id DESC LIMIT 1) p ON true
        WHERE upper(coalesce(to_jsonb(l)->>'kind', '')) IN ('ITEM', 'CHILD')`, ids(docNos));
  } catch (e) {
    if (isMissingRelation(e)) return { lines: null };
    throw e;
  }
  return {
    lines: res.map((r) => {
      const j = r.j ?? {};
      const groupRaw = r.category_group ? String(r.category_group).toUpperCase() : null;
      const group: CatalogGroup | null = isCatalogGroup(groupRaw) ? groupRaw : categoryGroupOf(r.category);
      const s = (k: string) => (j[k] == null ? null : String(j[k]));
      return {
        soItemId: r.so_item_id,
        soDocNo: r.doc_no,
        category: r.category,
        group,
        subCategory: r.sub_category ? String(r.sub_category).toUpperCase() : null,
        stageOverride: s("stage_code"),
        supplyByOwner: j.supply_by_owner === true || j.supply_by_owner === "true",
        qty: Number(r.qty ?? 0),
        room: s("room") ?? r.location,
        description: r.description,
        itemCode: r.item_code,
        omitted: s("omitted_by_vo_id") != null,
        supplierId: s("supplier_id"),
      };
    }),
  };
}

/** Customer instalments per SO with billed and received amounts. Reads phase 2's
    tables with phase 2's rule: an instalment is billed when it has a live bill;
    received is what its invoice has been paid, capped at the billed amount.
    TODO(phase 2 merge): swap for billingView(sb, soDocNo) from scm/lib/renovation-billing.ts. */
export async function loadBilling(db: Db, sos: readonly SoRow[]): Promise<Map<string, BillingFacts>> {
  const out = new Map<string, BillingFacts>();
  if (sos.length === 0) return out;
  const docNos = sos.map((s) => s.doc_no);
  let inst: Array<{ j: Record<string, unknown> }>;
  let bills: Array<{ j: Record<string, unknown> }>;
  try {
    inst = await rows(db,
      `SELECT to_jsonb(i) AS j FROM scm.reno_doc_instalments i
        WHERE coalesce(to_jsonb(i)->>'so_doc_no', to_jsonb(i)->>'doc_no') IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ids(docNos));
    const instIds = inst.map((r) => String(r.j.id));
    bills = instIds.length
      ? await rows(db,
          `SELECT to_jsonb(b) AS j FROM scm.reno_instalment_bills b
            WHERE to_jsonb(b)->>'instalment_id' IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ids(instIds))
      : [];
  } catch (e) {
    if (isMissingRelation(e)) {
      for (const so of sos) out.set(so.doc_no, { available: false, unavailableReason: "table_missing", contractSen: so.local_total_sen ?? null, instalments: [] });
      return out;
    }
    throw e;
  }
  const invoiceIds = [...new Set(bills.map((b) => b.j.sales_invoice_id ?? b.j.invoice_id).filter((x) => x != null).map(String))];
  const invoices = invoiceIds.length
    ? await rows<{ id: string; total_sen: number; paid_sen: number; status: string }>(db,
        `SELECT id::text AS id, total_sen, paid_sen, status::text AS status FROM scm.sales_invoices
          WHERE id::text IN (SELECT jsonb_array_elements_text(?::text::jsonb))`, ids(invoiceIds))
    : [];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const num = (x: unknown) => (x == null || x === "" ? 0 : Number(x));

  for (const so of sos) {
    const list: InstalmentFact[] = inst
      .filter((r) => String(r.j.so_doc_no ?? r.j.doc_no) === so.doc_no)
      .map((r) => {
        const j = r.j;
        const live = bills.filter((b) => String(b.j.instalment_id) === String(j.id)
          && !["CANCELLED", "VOID", "VOIDED"].includes(String(b.j.status ?? "").toUpperCase()));
        const billedSen = live.reduce((s, b) => s + num(b.j.amount_sen ?? b.j.billed_sen ?? b.j.expected_amount_sen), 0);
        const receivedSen = live.reduce((s, b) => {
          const inv = invById.get(String(b.j.sales_invoice_id ?? b.j.invoice_id ?? ""));
          const amt = num(b.j.amount_sen ?? b.j.billed_sen ?? b.j.expected_amount_sen);
          return s + (inv && inv.status !== "CANCELLED" ? Math.min(num(inv.paid_sen), Math.max(amt, 0)) : 0);
        }, 0);
        return {
          id: String(j.id),
          seq: num(j.seq),
          label: String(j.label ?? `Instalment ${num(j.seq)}`),
          pctBp: num(j.pct_bp),
          description: j.description == null ? null : String(j.description),
          stageCode: j.stage_code == null ? null : String(j.stage_code),
          trigger: normTrigger(j.trigger == null ? null : String(j.trigger)),
          billedSen,
          receivedSen,
          dueSen: j.expected_amount_sen == null ? null : num(j.expected_amount_sen),
          billed: live.length > 0,
        };
      })
      .sort((a, b) => a.seq - b.seq);
    out.set(so.doc_no, { available: true, contractSen: so.local_total_sen ?? null, instalments: list });
  }
  return out;
}
