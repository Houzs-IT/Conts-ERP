/* Conts only: the supply chain half of Property OS's one search box (owner, 3 Nov 2026: "search any keyword - customer
   name, project name, etc."). Property OS's server asks routes/renovationGlobalSearch.ts on the person's behalf; this
   file reads the records. Houzs's own /api/search (routes/search.ts) is left as it is.

   One rule for every kind of record: every word typed must appear in one of the record's text fields (case does not
   matter, any part of a word), OR the letters and digits typed, with spaces, dashes and other marks dropped, appear in
   one of its numbers (document numbers, phone numbers) with the same marks dropped. So "so 2610 001" finds SO-2610-001
   and "012-345 6789" finds +60 12 3456789. Each kind is limited to what the person's levels open (Property OS's
   Permissions chart, sent with the request) and to the active company. Matches only: no money, no record contents. */

import type { Db } from "./load";

export type RenoSearchKind =
  | "project"
  | "customer"
  | "quotation"
  | "sales_order"
  | "delivery_order"
  | "sales_invoice"
  | "purchase_order"
  | "grn"
  | "purchase_invoice"
  | "supplier"
  | "product"
  | "service_case"
  | "vo"
  | "delivery_return"
  | "consignment_order"
  | "consignment_note"
  | "consignment_return"
  | "purchase_consignment_order"
  | "purchase_consignment_receive"
  | "purchase_consignment_return"
  | "stock_transfer"
  | "stock_take"
  | "stock_adjustment";

export const RENO_SEARCH_KINDS: readonly RenoSearchKind[] = [
  "project", "customer", "quotation", "sales_order", "delivery_order", "sales_invoice",
  "purchase_order", "grn", "purchase_invoice", "supplier", "product", "service_case",
  "vo", "delivery_return", "consignment_order", "consignment_note", "consignment_return",
  "purchase_consignment_order", "purchase_consignment_receive", "purchase_consignment_return",
  "stock_transfer", "stock_take", "stock_adjustment",
];

export interface RenoSearchHit {
  kind: RenoSearchKind;
  id: string;
  label: string;
  sub: string;
  date: string | null;
  /** The engine screen that opens it. */
  path: string;
}

export interface RenoSearchResult { hits: RenoSearchHit[]; degraded: RenoSearchKind[] }

type Level = "none" | "view" | "edit" | "full";
export type RenoSearchAccess = Record<string, Level | undefined>;

/** The Property OS area whose level opens each kind (conts/access.ts maps the areas to the engine's pages). */
const AREA_OF: Record<RenoSearchKind, string[]> = {
  project: ["projects"],
  customer: ["scSales", "projects"],
  quotation: ["scSales"],
  sales_order: ["scSales"],
  delivery_order: ["scSales"],
  sales_invoice: ["scInvoices"],
  purchase_order: ["scProcurement"],
  grn: ["scProcurement"],
  purchase_invoice: ["scInvoices"],
  supplier: ["scProcurement"],
  product: ["scProcurement", "scSales"],
  service_case: ["serviceCases"],
  vo: ["scSales"],
  delivery_return: ["scSales"],
  consignment_order: ["scConsignment"],
  consignment_note: ["scConsignment"],
  consignment_return: ["scConsignment"],
  purchase_consignment_order: ["scConsignment"],
  purchase_consignment_receive: ["scConsignment"],
  purchase_consignment_return: ["scConsignment"],
  stock_transfer: ["scWarehouse"],
  stock_take: ["scWarehouse"],
  stock_adjustment: ["scWarehouse"],
};

export function kindsFor(access: RenoSearchAccess): RenoSearchKind[] {
  return RENO_SEARCH_KINDS.filter((k) => AREA_OF[k].some((a) => (access[a] ?? "none") !== "none"));
}

export interface SearchTerms {
  /** Up to five lower-case words, LIKE wildcards escaped, each wrapped in %. */
  words: string[];
  /** The letters and digits typed, nothing else, as %key% ('' when fewer than 3). */
  key: string;
  /** A Malaysian number typed with its country code (60...) also as the local number (0...), as %key% or ''. */
  localKey: string;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function searchTerms(raw: string): SearchTerms {
  const q = raw.trim().toLowerCase().slice(0, 80);
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5).map((w) => `%${likeEscape(w)}%`);
  const compact = q.replace(/[^a-z0-9]+/g, "");
  const key = compact.length >= 3 ? `%${compact}%` : "";
  const localKey = /^60\d{7,}$/.test(compact) ? `%${compact.slice(1)}%` : "";
  return { words, key, localKey };
}

/* The same expression as the indexes in migrations-pg/0206: letters and digits only, lower case. */
const norm = (col: string) => `regexp_replace(lower(coalesce(${col}, '')), '[^a-z0-9]+', '', 'g')`;

/** WHERE fragment and its arguments: every word in one of `text`, or the typed key in one of `keyed` (normalised). */
export function matchSql(t: SearchTerms, text: string[], keyed: string[]): { sql: string; args: string[] } {
  const args: string[] = [];
  const wordsSql = t.words.map((w) => {
    args.push(...text.map(() => w));
    return `(${text.map((c) => `${c} ILIKE ?`).join(" OR ")})`;
  });
  const arms: string[] = [];
  if (wordsSql.length) arms.push(`(${wordsSql.join(" AND ")})`);
  for (const k of [t.key, t.localKey].filter(Boolean)) {
    if (!keyed.length) continue;
    arms.push(`(${keyed.map((c) => `${norm(c)} LIKE ?`).join(" OR ")})`);
    args.push(...keyed.map(() => k));
  }
  return { sql: arms.length ? `(${arms.join(" OR ")})` : "FALSE", args };
}

export interface CompanyFragments {
  /** ` AND <col> = <active>` style fragments (companyScope.ts); "" when unresolved. Takes the column. */
  active: (col: string) => string;
  /** The service cases' scope: the caller's allowed companies (routes/assr.ts assrCompanySql). */
  allowed: (col: string) => string;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const join = (...parts: unknown[]) => parts.map(s).filter(Boolean).join(" · ");
/** The Malaysian calendar day of a date column, YYYY-MM-DD. Timestamp columns reach here as Date objects, text ones as strings. */
export function day(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

interface Source {
  kind: RenoSearchKind;
  run: (db: Db, t: SearchTerms, co: CompanyFragments, limit: number) => Promise<RenoSearchHit[]>;
}

async function rows(db: Db, sql: string, args: unknown[]): Promise<Array<Record<string, unknown>>> {
  const res = await db.prepare(sql).bind(...args).all<Record<string, unknown>>();
  return res.results ?? [];
}

const SOURCES: Source[] = [
  {
    kind: "project",
    async run(db, t, co, limit) {
      const m = matchSql(t,
        ["p.code", "p.name", "p.building", "p.unit_no", "p.customer_name", "p.customer_email"],
        ["p.code", "p.customer_phone"]);
      const r = await rows(db, `SELECT p.id, p.code, p.name, p.customer_name, p.customer_phone, p.building, p.unit_no, p.reno_stage
          FROM projects p
         WHERE p.project_kind = 'renovation' AND p.archived_at IS NULL${co.active("p.company_id")} AND ${m.sql}
         ORDER BY p.id DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "project" as const, id: s(x.id),
        label: join(x.code, x.name) || `Project ${s(x.id)}`,
        sub: join(x.customer_name, [s(x.building), s(x.unit_no)].filter(Boolean).join(" "), x.customer_phone),
        date: null, path: `/beta/projects/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "customer",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.name", "c.email", "c.customer_code"], ["c.phone", "c.customer_code"]);
      const r = await rows(db, `SELECT c.id, c.name, c.phone, c.email, c.city
          FROM scm.customers c
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.last_seen_at DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "customer" as const, id: s(x.id), label: s(x.name) || "Customer",
        sub: join(x.phone, x.email, x.city), date: null,
        // The renovation project list, searched for the customer: their projects, quotations and orders hang off it.
        path: `/beta/projects?q=${encodeURIComponent(s(x.name))}`,
      }));
    },
  },
  {
    kind: "quotation",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["q.quote_no", "p.code", "p.name", "p.customer_name"], ["q.quote_no", "p.customer_phone"]);
      const r = await rows(db, `SELECT q.id, q.quote_no, q.status, q.created_at, p.code, p.name, p.customer_name
          FROM scm.reno_quotations q JOIN projects p ON p.id = q.project_id
         WHERE true${co.active("q.company_id")} AND ${m.sql}
         ORDER BY q.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "quotation" as const, id: s(x.id), label: s(x.quote_no),
        sub: join(x.customer_name, join(x.code, x.name), titleWord(x.status)), date: day(x.created_at),
        path: `/scm/renovation/quotations/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "sales_order",
    async run(db, t, co, limit) {
      const m = matchSql(t,
        ["so.doc_no", "so.debtor_name", "so.ref", "so.customer_so_no", "p.code", "p.name"],
        ["so.doc_no", "so.phone"]);
      const r = await rows(db, `SELECT so.doc_no, so.debtor_name, so.so_date, so.phone, p.code, p.name
          FROM scm.mfg_sales_orders so LEFT JOIN projects p ON p.id = so.project_id
         WHERE true${co.active("so.company_id")} AND ${m.sql}
         ORDER BY so.so_date DESC NULLS LAST, so.doc_no DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "sales_order" as const, id: s(x.doc_no), label: s(x.doc_no),
        sub: join(x.debtor_name, join(x.code, x.name) || x.phone), date: day(x.so_date),
        path: `/scm/sales-orders/${encodeURIComponent(s(x.doc_no))}`,
      }));
    },
  },
  {
    kind: "delivery_order",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["d.do_number", "d.so_doc_no", "d.debtor_name", "d.ref"], ["d.do_number", "d.so_doc_no", "d.phone"]);
      const r = await rows(db, `SELECT d.id, d.do_number, d.so_doc_no, d.debtor_name, d.do_date
          FROM scm.delivery_orders d
         WHERE true${co.active("d.company_id")} AND ${m.sql}
         ORDER BY d.do_date DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "delivery_order" as const, id: s(x.id), label: s(x.do_number),
        sub: join(x.debtor_name, x.so_doc_no ? `SO ${s(x.so_doc_no)}` : ""), date: day(x.do_date),
        path: `/scm/delivery-orders/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "sales_invoice",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["i.invoice_number", "i.so_doc_no", "i.debtor_name", "i.ref"], ["i.invoice_number", "i.so_doc_no", "i.phone"]);
      const r = await rows(db, `SELECT i.id, i.invoice_number, i.so_doc_no, i.debtor_name, i.invoice_date
          FROM scm.sales_invoices i
         WHERE true${co.active("i.company_id")} AND ${m.sql}
         ORDER BY i.invoice_date DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "sales_invoice" as const, id: s(x.id), label: s(x.invoice_number),
        sub: join(x.debtor_name, x.so_doc_no ? `SO ${s(x.so_doc_no)}` : ""), date: day(x.invoice_date),
        path: `/scm/sales-invoices/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "purchase_order",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["po.po_number", "sup.name"], ["po.po_number"]);
      const r = await rows(db, `SELECT po.id, po.po_number, po.po_date, po.status, sup.name AS supplier
          FROM scm.purchase_orders po LEFT JOIN scm.suppliers sup ON sup.id = po.supplier_id
         WHERE true${co.active("po.company_id")} AND ${m.sql}
         ORDER BY po.po_date DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "purchase_order" as const, id: s(x.id), label: s(x.po_number),
        sub: join(x.supplier, titleWord(x.status)), date: day(x.po_date),
        path: `/scm/purchase-orders/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "grn",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["g.grn_number", "g.delivery_note_ref", "sup.name", "po.po_number"], ["g.grn_number", "g.delivery_note_ref"]);
      const r = await rows(db, `SELECT g.id, g.grn_number, g.received_at, sup.name AS supplier, po.po_number
          FROM scm.grns g LEFT JOIN scm.suppliers sup ON sup.id = g.supplier_id LEFT JOIN scm.purchase_orders po ON po.id = g.purchase_order_id
         WHERE true${co.active("g.company_id")} AND ${m.sql}
         ORDER BY g.received_at DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "grn" as const, id: s(x.id), label: s(x.grn_number),
        sub: join(x.supplier, x.po_number ? `PO ${s(x.po_number)}` : ""), date: day(x.received_at),
        path: `/scm/grns/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "purchase_invoice",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["pi.invoice_number", "pi.supplier_invoice_ref", "sup.name"], ["pi.invoice_number", "pi.supplier_invoice_ref"]);
      const r = await rows(db, `SELECT pi.id, pi.invoice_number, pi.supplier_invoice_ref, pi.invoice_date, sup.name AS supplier
          FROM scm.purchase_invoices pi LEFT JOIN scm.suppliers sup ON sup.id = pi.supplier_id
         WHERE true${co.active("pi.company_id")} AND ${m.sql}
         ORDER BY pi.invoice_date DESC NULLS LAST LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "purchase_invoice" as const, id: s(x.id), label: s(x.invoice_number),
        sub: join(x.supplier, x.supplier_invoice_ref), date: day(x.invoice_date),
        path: `/scm/purchase-invoices/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "supplier",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["sup.code", "sup.name", "sup.contact_person", "sup.email"], ["sup.code", "sup.phone"]);
      const r = await rows(db, `SELECT sup.id, sup.code, sup.name, sup.contact_person, sup.phone
          FROM scm.suppliers sup
         WHERE true${co.active("sup.company_id")} AND ${m.sql}
         ORDER BY sup.name LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "supplier" as const, id: s(x.id), label: s(x.name) || s(x.code),
        sub: join(x.code, x.contact_person, x.phone), date: null,
        path: `/scm/suppliers/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "product",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["pr.code", "pr.name", "pr.description"], ["pr.code"]);
      const r = await rows(db, `SELECT pr.code, pr.name, pr.description
          FROM scm.mfg_products pr
         WHERE pr.status::text = 'ACTIVE'${co.active("pr.company_id")} AND ${m.sql}
         ORDER BY pr.code LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "product" as const, id: s(x.code), label: join(x.code, x.name) || s(x.code),
        sub: s(x.description), date: null,
        path: `/scm/products?focus=${encodeURIComponent(s(x.code))}`,
      }));
    },
  },
  {
    kind: "service_case",
    async run(db, t, co, limit) {
      const m = matchSql(t,
        ["c.assr_no", "c.customer_name", "c.complaint_issue", "c.doc_no", "p.code", "p.name"],
        ["c.assr_no", "c.doc_no", "c.phone", "p.customer_phone"]);
      const r = await rows(db, `SELECT c.id, c.assr_no, c.customer_name, c.complaint_issue, c.stage, c.complained_date, p.code, p.name
          FROM assr_cases c LEFT JOIN projects p ON p.id = c.project_id
         WHERE c.archived_at IS NULL${co.allowed("c.company_id")} AND ${m.sql}
         ORDER BY c.complained_date DESC NULLS LAST, c.id DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "service_case" as const, id: s(x.id), label: s(x.assr_no) || `Case ${s(x.id)}`,
        sub: join(x.customer_name, join(x.code, x.name), x.complaint_issue), date: day(x.complained_date),
        path: `/assr/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "vo",
    async run(db, t, co, limit) {
      const m = matchSql(t,
        ["a.amendment_no", "a.so_doc_no", "a.reason", "so.debtor_name", "p.code", "p.name"],
        ["a.amendment_no", "a.so_doc_no", "so.phone"]);
      const r = await rows(db, `SELECT a.id, a.amendment_no, a.so_doc_no, a.status, a.created_at, so.debtor_name
          FROM scm.so_amendments a
          LEFT JOIN scm.mfg_sales_orders so ON so.doc_no = a.so_doc_no
          LEFT JOIN projects p ON p.id = so.project_id
         WHERE true${co.active("a.company_id")} AND ${m.sql}
         ORDER BY a.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "vo" as const, id: s(x.id), label: s(x.amendment_no),
        sub: join(x.debtor_name, x.so_doc_no ? `SO ${s(x.so_doc_no)}` : "", titleWord(x.status)), date: day(x.created_at),
        path: `/scm/amendments/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "delivery_return",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["d.return_number", "d.do_doc_no", "d.debtor_name", "d.ref", "d.reason"], ["d.return_number", "d.do_doc_no", "d.phone"]);
      const r = await rows(db, `SELECT d.id, d.return_number, d.do_doc_no, d.debtor_name, d.return_date, d.status
          FROM scm.delivery_returns d
         WHERE true${co.active("d.company_id")} AND ${m.sql}
         ORDER BY d.return_date DESC NULLS LAST, d.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "delivery_return" as const, id: s(x.id), label: s(x.return_number),
        sub: join(x.debtor_name, x.do_doc_no ? `DO ${s(x.do_doc_no)}` : "", titleWord(x.status)), date: day(x.return_date),
        path: `/scm/delivery-returns/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "consignment_order",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.doc_no", "c.debtor_name", "c.ref", "c.customer_so_no"], ["c.doc_no", "c.phone"]);
      const r = await rows(db, `SELECT c.doc_no, c.debtor_name, c.so_date, c.status
          FROM scm.consignment_sales_orders c
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.so_date DESC NULLS LAST, c.doc_no DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "consignment_order" as const, id: s(x.doc_no), label: s(x.doc_no),
        sub: join(x.debtor_name, titleWord(x.status)), date: day(x.so_date),
        path: `/scm/consignment-orders/${encodeURIComponent(s(x.doc_no))}`,
      }));
    },
  },
  {
    kind: "consignment_note",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.do_number", "c.consignment_so_doc_no", "c.debtor_name", "c.ref"], ["c.do_number", "c.consignment_so_doc_no", "c.phone"]);
      const r = await rows(db, `SELECT c.id, c.do_number, c.consignment_so_doc_no, c.debtor_name, c.do_date, c.status
          FROM scm.consignment_delivery_orders c
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.do_date DESC NULLS LAST, c.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "consignment_note" as const, id: s(x.id), label: s(x.do_number),
        sub: join(x.debtor_name, x.consignment_so_doc_no, titleWord(x.status)), date: day(x.do_date),
        path: `/scm/consignment-notes/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "consignment_return",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.return_number", "c.do_doc_no", "c.debtor_name", "c.ref", "c.reason"], ["c.return_number", "c.do_doc_no", "c.phone"]);
      const r = await rows(db, `SELECT c.id, c.return_number, c.do_doc_no, c.debtor_name, c.return_date, c.status
          FROM scm.consignment_delivery_returns c
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.return_date DESC NULLS LAST, c.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "consignment_return" as const, id: s(x.id), label: s(x.return_number),
        sub: join(x.debtor_name, x.do_doc_no, titleWord(x.status)), date: day(x.return_date),
        path: `/scm/consignment-returns/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "purchase_consignment_order",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.pc_number", "sup.name"], ["c.pc_number"]);
      const r = await rows(db, `SELECT c.id, c.pc_number, c.po_date, c.status, sup.name AS supplier
          FROM scm.purchase_consignment_orders c LEFT JOIN scm.suppliers sup ON sup.id = c.supplier_id
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.po_date DESC NULLS LAST, c.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "purchase_consignment_order" as const, id: s(x.id), label: s(x.pc_number),
        sub: join(x.supplier, titleWord(x.status)), date: day(x.po_date),
        path: `/scm/purchase-consignment-orders/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "purchase_consignment_receive",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.receive_number", "c.pc_order_no", "c.delivery_note_ref", "sup.name"], ["c.receive_number", "c.pc_order_no", "c.delivery_note_ref"]);
      const r = await rows(db, `SELECT c.id, c.receive_number, c.pc_order_no, c.received_at, c.status, sup.name AS supplier
          FROM scm.purchase_consignment_receives c LEFT JOIN scm.suppliers sup ON sup.id = c.supplier_id
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.received_at DESC NULLS LAST, c.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "purchase_consignment_receive" as const, id: s(x.id), label: s(x.receive_number),
        sub: join(x.supplier, x.pc_order_no, titleWord(x.status)), date: day(x.received_at),
        path: `/scm/purchase-consignment-receives/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "purchase_consignment_return",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["c.return_number", "c.credit_note_ref", "c.reason", "sup.name"], ["c.return_number", "c.credit_note_ref"]);
      const r = await rows(db, `SELECT c.id, c.return_number, c.return_date, c.status, sup.name AS supplier
          FROM scm.purchase_consignment_returns c LEFT JOIN scm.suppliers sup ON sup.id = c.supplier_id
         WHERE true${co.active("c.company_id")} AND ${m.sql}
         ORDER BY c.return_date DESC NULLS LAST, c.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "purchase_consignment_return" as const, id: s(x.id), label: s(x.return_number),
        sub: join(x.supplier, titleWord(x.status)), date: day(x.return_date),
        path: `/scm/purchase-consignment-returns/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "stock_transfer",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["st.transfer_no", "st.notes", "f.name", "w.name"], ["st.transfer_no"]);
      const r = await rows(db, `SELECT st.id, st.transfer_no, st.transfer_date, st.status, f.name AS from_wh, w.name AS to_wh
          FROM scm.stock_transfers st
          LEFT JOIN scm.warehouses f ON f.id = st.from_warehouse_id
          LEFT JOIN scm.warehouses w ON w.id = st.to_warehouse_id
         WHERE true${co.active("st.company_id")} AND ${m.sql}
         ORDER BY st.transfer_date DESC NULLS LAST, st.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "stock_transfer" as const, id: s(x.id), label: s(x.transfer_no),
        sub: join([s(x.from_wh), s(x.to_wh)].filter(Boolean).join(" to "), titleWord(x.status)), date: day(x.transfer_date),
        path: `/scm/stock-transfers/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    kind: "stock_take",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["st.take_no", "st.notes", "w.name"], ["st.take_no"]);
      const r = await rows(db, `SELECT st.id, st.take_no, st.take_date, st.status, w.name AS warehouse
          FROM scm.stock_takes st LEFT JOIN scm.warehouses w ON w.id = st.warehouse_id
         WHERE true${co.active("st.company_id")} AND ${m.sql}
         ORDER BY st.take_date DESC NULLS LAST, st.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "stock_take" as const, id: s(x.id), label: s(x.take_no),
        sub: join(x.warehouse, titleWord(x.status)), date: day(x.take_date),
        path: `/scm/stock-takes/${encodeURIComponent(s(x.id))}`,
      }));
    },
  },
  {
    // A stock adjustment has no number and no page of its own: it is one line of the stock ledger, found by what it
    // moved, and opens the Stock adjustments list searched for that item.
    kind: "stock_adjustment",
    async run(db, t, co, limit) {
      const m = matchSql(t, ["im.item_code", "im.product_name", "im.notes", "im.reason_code", "w.name"], ["im.item_code", "im.source_doc_no"]);
      const r = await rows(db, `SELECT im.id, im.item_code, im.product_name, im.reason_code, im.movement_date, im.created_at, w.name AS warehouse
          FROM scm.inventory_movements im LEFT JOIN scm.warehouses w ON w.id = im.warehouse_id
         WHERE im.source_doc_type = 'ADJUSTMENT'${co.active("im.company_id")} AND ${m.sql}
         ORDER BY im.created_at DESC LIMIT ${limit}`, m.args);
      return r.map((x) => ({
        kind: "stock_adjustment" as const, id: s(x.id), label: join(x.item_code, x.product_name) || s(x.item_code),
        sub: join(x.warehouse, titleWord(x.reason_code)), date: day(x.movement_date ?? x.created_at),
        path: `/scm/stock-adjustments?q=${encodeURIComponent(s(x.item_code))}`,
      }));
    },
  },
];

function titleWord(v: unknown): string {
  const w = s(v).toLowerCase().replace(/_/g, " ");
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
}

/** Searches the kinds asked for (all the access opens when `only` is empty), `limit` rows each. A kind whose read
 *  fails is named in `degraded`, so the screen can say it could not look instead of showing it as empty. */
export async function renovationSearch(
  db: Db, raw: string, access: RenoSearchAccess, co: CompanyFragments, opts: { only?: RenoSearchKind | null; limit: number },
): Promise<RenoSearchResult> {
  const t = searchTerms(raw);
  if (!t.words.length) return { hits: [], degraded: [] };
  const open = new Set(kindsFor(access));
  const sources = SOURCES.filter((src) => open.has(src.kind) && (!opts.only || opts.only === src.kind));
  const settled = await Promise.allSettled(sources.map((src) => src.run(db, t, co, opts.limit)));
  const hits: RenoSearchHit[] = [];
  const degraded: RenoSearchKind[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") hits.push(...r.value);
    else {
      console.warn(`[conts-search] ${sources[i].kind} unreadable:`, r.reason instanceof Error ? r.reason.message : r.reason);
      degraded.push(sources[i].kind);
    }
  });
  return { hits, degraded };
}
