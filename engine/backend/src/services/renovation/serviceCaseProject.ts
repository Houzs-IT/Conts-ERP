/* Service cases raised against a renovation project (owner, 15 Oct 2026: "It shouldn't look up the SO, it should
   look up the PROJECT"). In renovation mode the New Service Case form picks a project; the case takes the
   project's customer (the shared customer block, scm/shared/renovation-property.ts) and stores project_id
   (migration 0081). When the project has a sales order its doc no is kept on the case as well, for whatever
   still reads doc_no; the user never picks one. Houzs mode never reaches this file. */

import type { Db } from "./load";
import { renovationMode } from "./customerProperty";
import { normalizePhone } from "../../scm/shared/phone";
import { assrOpenStageSql } from "../assrStages";

export interface CaseProject {
  id: number;
  code: string | null;
  name: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  address1: string;
  address2: string;
  postcode: string;
  city: string;
  state: string;
  siteAddress: string;
  building: string;
  unitNo: string;
  /** The project's sales order (newest one not cancelled), '' when it has none. */
  soDocNo: string;
  openCaseCount: number;
}

export interface CaseCategoryGroup { code: string; label: string; subs: { code: string; label: string }[] }

const t = (v: unknown): string => (v == null ? "" : String(v).trim());

/* The project row is read through to_jsonb so the 0115 address columns are simply blank on a database
   that does not have them yet. No "--" comments inside the SQL: the d1-compat shim folds it to one line. */
const PROJECT_SELECT = `
  SELECT to_jsonb(p) AS row,
         (SELECT so.doc_no FROM scm.mfg_sales_orders so
           WHERE so.project_id = p.id AND so.status::text <> 'CANCELLED'
           ORDER BY so.so_date DESC NULLS LAST, so.doc_no DESC LIMIT 1) AS so_doc_no,
         (SELECT count(*)::int FROM assr_cases ac
           WHERE ac.project_id = p.id AND ac.archived_at IS NULL AND ${assrOpenStageSql("ac")}) AS open_case_count
    FROM projects p`;

type ProjectRow = { row: Record<string, unknown> | string; so_doc_no: string | null; open_case_count: number | null };

function toCaseProject(r: ProjectRow): CaseProject {
  const row = (typeof r.row === "string" ? JSON.parse(r.row) : r.row) as Record<string, unknown>;
  return {
    id: Number(row.id),
    code: row.code == null ? null : t(row.code),
    name: t(row.name),
    customerName: t(row.customer_name),
    customerPhone: t(row.customer_phone),
    customerEmail: t(row.customer_email),
    address1: t(row.address1),
    address2: t(row.address2),
    postcode: t(row.postcode),
    city: t(row.city),
    state: t(row.state),
    siteAddress: t(row.site_address),
    building: t(row.building),
    unitNo: t(row.unit_no),
    soDocNo: t(r.so_doc_no),
    openCaseCount: Number(r.open_case_count ?? 0),
  };
}

/** The search terms a project answers to: code, name, building, unit, customer name, phone (digits only too). */
export function projectSearchArgs(q: string): { like: string; digits: string } {
  const s = q.trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  return { like: `%${s}%`, digits: digits.length >= 3 ? `%${digits}%` : "" };
}

/** Renovation projects of this company matching q, newest first (all of them, up to 20, when q is blank). */
export async function searchCaseProjects(db: Db, companySql: string, q: string): Promise<CaseProject[]> {
  const { like, digits } = projectSearchArgs(q);
  const res = await db.prepare(
    `${PROJECT_SELECT}
      WHERE p.project_kind = 'renovation' AND p.archived_at IS NULL${companySql}
        AND (? = '%%'
             OR lower(coalesce(p.code, '')) LIKE ? OR lower(coalesce(p.name, '')) LIKE ?
             OR lower(coalesce(p.building, '')) LIKE ? OR lower(coalesce(p.unit_no, '')) LIKE ?
             OR lower(coalesce(p.customer_name, '')) LIKE ? OR lower(coalesce(p.customer_phone, '')) LIKE ?
             OR (? <> '' AND regexp_replace(coalesce(p.customer_phone, ''), '[^0-9]', '', 'g') LIKE ?))
      ORDER BY p.id DESC LIMIT 20`,
  ).bind(like, like, like, like, like, like, like, digits, digits).all<ProjectRow>();
  return (res.results ?? []).map(toCaseProject);
}

/** One renovation project of this company, or null (not found, archived ones included). */
export async function readCaseProject(db: Db, id: number, companySql: string): Promise<CaseProject | null> {
  const r = await db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.project_kind = 'renovation'${companySql}`).bind(id).first<ProjectRow>();
  return r ? toCaseProject(r) : null;
}

/** The case's customer columns from its project. assr_cases keeps four address lines: line 1, line 2,
    "postcode city", state; a project saved before 0115 has only its one site address, split by line. */
export function caseFieldsFromProject(p: CaseProject, email?: string | null): {
  customer_name: string | null; phone: string | null; customer_email: string | null;
  addr1: string | null; addr2: string | null; addr3: string | null; addr4: string | null;
} {
  const orNull = (s: string) => (s ? s : null);
  const structured = !!(p.address1 || p.address2 || p.city || p.postcode || p.state);
  const lines = structured
    ? [p.address1, p.address2, [p.postcode, p.city].filter(Boolean).join(" "), p.state]
    : p.siteAddress.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  /* More than four site-address lines: the rest join the fourth so nothing is lost. */
  const four = lines.length > 4 ? [...lines.slice(0, 3), lines.slice(3).join(", ")] : lines;
  const phone = p.customerPhone ? (normalizePhone(p.customerPhone) ?? p.customerPhone.replace(/[^\d+]/g, "")) : "";
  return {
    customer_name: orNull(p.customerName),
    phone: orNull(phone),
    customer_email: orNull(t(email) || p.customerEmail),
    addr1: orNull(t(four[0])), addr2: orNull(t(four[1])), addr3: orNull(t(four[2])), addr4: orNull(t(four[3])),
  };
}

/** Link a just-created case to its project and give it the project's customer (the project is the master). */
export async function stampCaseFromProject(db: Db, caseId: number, p: CaseProject, email?: string | null): Promise<void> {
  const f = caseFieldsFromProject(p, email);
  await db.prepare(
    `UPDATE assr_cases SET project_id = ?, customer_name = ?, phone = ?, customer_email = ?, addr1 = ?, addr2 = ?, addr3 = ?, addr4 = ?
      WHERE id = ?`,
  ).bind(p.id, f.customer_name, f.phone, f.customer_email, f.addr1, f.addr2, f.addr3, f.addr4, caseId).run();
}

/** Project code and name for the cases that have one, so the list and the detail can show and link it. */
export async function annotateCaseProjects(db: Db, cases: ReadonlyArray<Record<string, unknown> | null | undefined>): Promise<void> {
  const idOf = (r: Record<string, unknown>) => Number(r.project_id ?? r.projectId ?? 0);
  const rows = cases.filter((r): r is Record<string, unknown> => !!r && idOf(r) > 0);
  if (rows.length === 0) return;
  const ids = [...new Set(rows.map(idOf))];
  const res = await db.prepare(
    `SELECT id::int AS id, code, name FROM projects WHERE id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)`,
  ).bind(JSON.stringify(ids.map(String))).all<{ id: number; code: string | null; name: string | null }>();
  const byId = new Map((res.results ?? []).map((p) => [Number(p.id), p]));
  for (const r of rows) {
    const p = byId.get(idOf(r));
    r.project_id = idOf(r);
    r.project_code = p?.code ?? null;
    r.project_name = p?.name ?? null;
  }
}

/** The renovation catalog's categories and active sub-categories (the procurement list), for "what item is it about". */
export async function readCaseCategories(db: Db): Promise<CaseCategoryGroup[]> {
  const [groups, subs] = await Promise.all([
    db.prepare(`SELECT code, label FROM scm.product_category_groups ORDER BY sort_order, code`).bind().all<{ code: string; label: string }>(),
    db.prepare(`SELECT group_code, code, label FROM scm.product_sub_categories WHERE active ORDER BY group_code, sort_order, code`).bind()
      .all<{ group_code: string; code: string; label: string }>(),
  ]);
  return (groups.results ?? []).map((g) => ({
    code: g.code,
    label: g.label,
    subs: (subs.results ?? []).filter((s) => s.group_code === g.code).map((s) => ({ code: s.code, label: s.label })),
  }));
}

export { renovationMode };
