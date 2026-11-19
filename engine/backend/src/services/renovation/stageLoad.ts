/* Reads what the stage rules need (stageRules.ts, flow.ts), set-based for any number of projects: one read each for
   the design facts, the sales order lines, the variation orders and the catalog, one per company for the Design work
   list, and the payments the Beta workspace reads (projectPayments.ts). A table an older environment lacks reads as
   empty; any other error is thrown. */

import { findIncompleteVariantLines } from "../../scm/lib/so-variant-check";
import type { BillingView } from "../../scm/lib/renovation-billing";
import { isMissingRelation, type Db, type ProjectRow } from "./load";
import { PROJECT_SO_SQL, projectPayments, type ProjectSoRow } from "./projectPayments";
import type { StageAppointment, StageFile, StageInputs, StageLine, StageNote, StageReview, StageWork } from "./stageRules";
import { listWorkTypes, type WorkType } from "./workTypes";

const MYT = "Asia/Kuala_Lumpur";
const ids = (xs: ReadonlyArray<string | number>) => JSON.stringify(xs.map(String));
const IN_PROJECTS = "(SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)";

async function rows<T>(db: Db, sql: string, ...args: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...args).all<T>();
  return (res.results ?? []) as T[];
}

async function orEmpty<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

function list<T>(x: unknown): T[] {
  let v = x;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? (v as T[]) : [];
}

interface DesignRow {
  project_id: number; measured_on: string | null; appointments: unknown; works: unknown; files: unknown; notes: unknown; reviews: unknown;
}
interface LineRow {
  project_id: number; id: string; item_code: string | null; item_group: string | null; variants: Record<string, unknown> | null;
  qty: number; delivered: number; category: string | null; credit: boolean;
}

/** The design facts per project, the same reads as the Beta board (routes/renovationBeta.ts GET /board). */
const DESIGN_SQL = `
  SELECT p.id::int AS project_id,
         (SELECT min(r.done_on) FROM project_design_records r WHERE r.project_id = p.id AND r.kind = 'site_measure')::text AS measured_on,
         (SELECT coalesce(json_agg(json_build_object('kind', a.kind, 'onDate', a.on_date::text, 'doneAt', a.done_at::text)), '[]'::json)
            FROM project_beta_appointments a WHERE a.project_id = p.id) AS appointments,
         (SELECT coalesce(json_agg(json_build_object('type', e.type, 'onDate', e.on_date::text, 'done', e.done)), '[]'::json)
            FROM (SELECT DISTINCT ON (x.type) x.type, x.on_date, x.done FROM project_beta_events x
                   WHERE x.project_id = p.id AND x.company_id = p.company_id ORDER BY x.type, x.on_date DESC, x.id DESC) e) AS works,
         (SELECT coalesce(json_agg(json_build_object('id', f.id::int, 'kind', f.kind, 'version', f.version::int,
                   'submittedOn', coalesce(f.submitted_on, (f.uploaded_at AT TIME ZONE '${MYT}')::date)::text)), '[]'::json)
            FROM project_design_files f WHERE f.project_id = p.id AND f.kind IN ('3d', '2d')) AS files,
         (SELECT coalesce(json_agg(json_build_object('id', n.id::int, 'kind', n.kind, 'notedOn', n.noted_on::text,
                   'closedOn', (n.closed_at AT TIME ZONE '${MYT}')::date::text)), '[]'::json)
            FROM project_design_notes n WHERE n.project_id = p.id) AS notes,
         (SELECT coalesce(json_agg(json_build_object('fileId', r.file_id::int, 'approvedOn', r.approved_on::text)), '[]'::json)
            FROM project_design_file_reviews r WHERE r.project_id = p.id) AS reviews
    FROM projects p WHERE p.id IN ${IN_PROJECTS}`;

/** Every live line of the projects' live sales orders, with its catalog category and what was delivered (the project SO
    tab's reading: delivery orders not draft or cancelled, less delivery returns). */
const LINES_SQL = `
  SELECT so.project_id::int AS project_id, i.id::text AS id, i.item_code, i.item_group, i.variants, i.qty,
         prod.category_group AS category, (i.item_code IS NOT DISTINCT FROM 'RENO-CREDIT') AS credit,
         (SELECT coalesce(sum(doi.qty), 0)::int FROM scm.delivery_order_items doi JOIN scm.delivery_orders dd ON dd.id = doi.delivery_order_id
           WHERE doi.so_item_id = i.id AND dd.status::text NOT IN ('CANCELLED', 'DRAFT'))
         - (SELECT coalesce(sum(ri.qty_returned), 0)::int FROM scm.delivery_return_items ri
              JOIN scm.delivery_returns dr ON dr.id = ri.delivery_return_id AND dr.status::text <> 'CANCELLED'
              JOIN scm.delivery_order_items doi ON doi.id = ri.do_item_id
              JOIN scm.delivery_orders dd ON dd.id = doi.delivery_order_id AND dd.status::text NOT IN ('CANCELLED', 'DRAFT')
             WHERE doi.so_item_id = i.id) AS delivered
    FROM scm.mfg_sales_order_items i
    JOIN scm.mfg_sales_orders so ON so.doc_no = i.doc_no
    JOIN projects p ON p.id = so.project_id AND p.company_id = so.company_id
    LEFT JOIN LATERAL (SELECT mp.category_group FROM scm.mfg_products mp WHERE mp.code = i.item_code AND mp.company_id = so.company_id
                        ORDER BY (mp.status::text = 'ACTIVE') DESC LIMIT 1) prod ON true
   WHERE so.project_id IN ${IN_PROJECTS} AND so.status::text <> 'CANCELLED' AND NOT coalesce(i.cancelled, false)`;

/** Variation orders per project: the renovation contract's own (not cancelled) and the sales order amendments that are
    not one of them (not rejected), on any live sales order of the project, the same set the project's VO tab lists. */
const VO_SQL = `
  SELECT so.project_id::int AS project_id,
         (count(DISTINCT v.id) + count(DISTINCT a.id))::int AS n
    FROM scm.mfg_sales_orders so
    LEFT JOIN scm.reno_variation_orders v ON v.so_doc_no = so.doc_no AND v.status::text <> 'CANCELLED'
    LEFT JOIN scm.so_amendments a ON a.so_doc_no = so.doc_no AND a.status::text <> 'REJECTED'
         AND NOT EXISTS (SELECT 1 FROM scm.reno_variation_orders rv WHERE rv.amendment_id = a.id)
   WHERE so.project_id IN ${IN_PROJECTS} AND so.status::text <> 'CANCELLED'
   GROUP BY so.project_id`;

async function companyPayments(db: Db, companyId: number, pids: readonly number[], billing?: Promise<Map<string, BillingView> | null>): Promise<{ sos: ProjectSoRow[]; pay: Map<number, StageInputs["payment"]> }> {
  const pay = new Map<number, StageInputs["payment"]>();
  try {
    const [sos, pre] = await Promise.all([rows<ProjectSoRow>(db, PROJECT_SO_SQL(`p.id IN ${IN_PROJECTS}`), ids(pids), companyId), billing]);
    // The shared billing read found phase 2's tables missing: the same answer as reading them here.
    if (pre === null && sos.some((s) => s.kind === "RENOVATION")) return { sos: [], pay };
    for (const [id, p] of await projectPayments(db, companyId, sos, pre ?? undefined)) {
      if (p.state !== "ok") continue;
      pay.set(id, { contractSen: p.contractSen, receivedSen: p.receivedSen, paidInstalments: p.instalments.filter((x) => x.status === "paid" && x.amountSen > 0).length });
    }
    return { sos, pay };
  } catch (e) {
    if (isMissingRelation(e)) return { sos: [], pay };
    throw e;
  }
}

/* The catalog's category groups change only in catalog maintenance; one read a minute per isolate is plenty. */
const GROUPS_TTL_MS = 60_000;
let groupsCache: { at: number; rows: Array<{ code: string; label: string }> } | null = null;
async function categoryGroups(db: Db): Promise<Array<{ code: string; label: string }>> {
  if (groupsCache && Date.now() - groupsCache.at < GROUPS_TTL_MS) return groupsCache.rows;
  const list = await orEmpty(rows<{ code: string; label: string }>(db, `SELECT code, label FROM scm.product_category_groups ORDER BY sort_order, code`));
  groupsCache = { at: Date.now(), rows: list };
  return list;
}

export interface StagePreloaded {
  /** the renovation contracts' billing views, already being read by the caller (load.ts); null when phase 2's tables are missing */
  billing?: Promise<Map<string, BillingView> | null>;
}

export async function loadStageInputs(db: Db, projects: readonly ProjectRow[], pre: StagePreloaded = {}): Promise<Map<number, StageInputs>> {
  const out = new Map<number, StageInputs>();
  if (projects.length === 0) return out;
  const pids = projects.map((p) => p.id);
  const byCompany = new Map<number, number[]>();
  for (const p of projects) byCompany.set(Number(p.company_id), [...(byCompany.get(Number(p.company_id)) ?? []), p.id]);
  const companies = [...byCompany.keys()];

  const [design, lines, vos, groups, workTypes, payments] = await Promise.all([
    orEmpty(rows<DesignRow>(db, DESIGN_SQL, ids(pids))),
    orEmpty(rows<LineRow>(db, LINES_SQL, ids(pids))),
    orEmpty(rows<{ project_id: number; n: number }>(db, VO_SQL, ids(pids))),
    categoryGroups(db),
    Promise.all(companies.map(async (co) => [co, await listWorkTypes(db, co)] as const)),
    Promise.all(companies.map((co) => companyPayments(db, co, byCompany.get(co)!, pre.billing))),
  ]);
  const workTypesBy = new Map<number, WorkType[]>(workTypes);
  const designBy = new Map(design.map((d) => [Number(d.project_id), d]));
  const voBy = new Map(vos.map((v) => [Number(v.project_id), Number(v.n)]));
  const soProjects = new Set(payments.flatMap((p) => p.sos.map((s) => Number(s.project_id))));
  const payBy = new Map(payments.flatMap((p) => [...p.pay]));
  const linesBy = new Map<number, LineRow[]>();
  for (const l of lines) linesBy.set(Number(l.project_id), [...(linesBy.get(Number(l.project_id)) ?? []), l]);
  const categories = groups.map((g) => ({ code: String(g.code), label: String(g.label ?? g.code) }));

  for (const p of projects) {
    const d = designBy.get(p.id);
    const mine = linesBy.get(p.id) ?? [];
    const missing = findIncompleteVariantLines(mine.map((l) => ({ id: l.id, itemCode: l.item_code ?? "", group: l.item_group, variants: l.variants }))).length;
    out.set(p.id, {
      hasSo: soProjects.has(p.id) || mine.length > 0,
      payment: payBy.get(p.id) ?? null,
      workTypes: workTypesBy.get(Number(p.company_id)) ?? [],
      measuredOn: d?.measured_on ?? null,
      appointments: list<StageAppointment>(d?.appointments),
      works: list<StageWork>(d?.works).map((w) => ({ ...w, done: w.done === true || String(w.done) === "true" })),
      files: list<StageFile>(d?.files).map((f) => ({ ...f, id: Number(f.id), version: Number(f.version) })),
      notes: list<StageNote>(d?.notes).map((n) => ({ ...n, id: Number(n.id) })),
      reviews: list<StageReview>(d?.reviews).map((r) => ({ ...r, fileId: Number(r.fileId) })),
      variants: { lines: mine.length, missing },
      voCount: voBy.get(p.id) ?? 0,
      categories,
      lines: mine.filter((l) => !(l.credit === true || String(l.credit) === "true"))
        .map((l): StageLine => ({ category: l.category ? String(l.category) : null, qty: Number(l.qty ?? 0), delivered: Number(l.delivered ?? 0) })),
    });
  }
  return out;
}
