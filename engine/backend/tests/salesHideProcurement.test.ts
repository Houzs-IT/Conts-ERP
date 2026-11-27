// Salespeople never see purchase orders, goods receipts, production orders or purchase invoices (owner, 27 Nov 2026).
// Each read that used to carry them is asked once as a salesperson (procurement at none) and once as a purchaser.
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rows = Record<string, unknown[]>;
const state: { rows: Rows; asked: string[] } = { rows: {}, asked: [] };

// A table counts as read when its query is sent (awaited), not when the builder is made.
function builder(table: string, data: unknown[]): unknown {
  const result = { data, error: null, count: data.length };
  const b: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") {
        state.asked.push(table);
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      }
      if (prop === "maybeSingle" || prop === "single") {
        state.asked.push(table);
        return () => Promise.resolve({ data: data[0] ?? null, error: null });
      }
      return () => b;
    },
  });
  return b;
}

vi.mock("../src/db/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseService: () => ({
    from(table: string) {
      return builder(table, state.rows[table] ?? []);
    },
  }),
}));

const LINE = "11111111-1111-4111-8111-111111111111";
vi.mock("../src/scm/routes/mfg-sales-orders", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  soCoverage: async () => ({ coverage: new Map([[LINE, { source: "po", po: "TC-PO-9", eta: "2026-12-01" }]]) }),
}));

const { procurementFlag, requireProcurementVisible } = await import("../src/scm/middleware/procurement-flag");
const { renovationDocTrail } = await import("../src/scm/routes/renovation-doc-trail");
const { documentFlow, withoutPurchaseSide } = await import("../src/scm/routes/document-flow");
const { runGlobalSearch } = await import("../src/routes/search");

const SALES = { id: 41, email: "sales@example.test", permissions: ["scm.access"], permissions_set: new Set(["scm.access"]), page_access: { "scm.procurement": "none", "scm.sales.orders": "edit" } };
const PURCHASER = { id: 42, email: "buyer@example.test", permissions: ["scm.access"], permissions_set: new Set(["scm.access"]), page_access: { "scm.procurement": "edit" } };
type Caller = typeof SALES;

function appFor(user: Caller, router: Hono<any>, companyId?: number) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, user as never);
    if (companyId != null) c.set("companyId" as never, companyId as never);
    await next();
  });
  app.use("*", procurementFlag as never);
  app.use("/po-so-coverage/*", requireProcurementVisible as never);
  app.get("/po-so-coverage/:type/:id", (c) => c.json({ origins: [] }));
  app.route("/", router);
  return app;
}

/* A stand-in database: it answers each arm the query actually contains, so a purchase row only comes back when the
   SQL asked for it. */
function trailDb(sqls: string[], binds: unknown[][]) {
  const po = { kind: "po", id: "p1", no: "TC-PO-1", status: "SUBMITTED", on_hold: false, expected: "2026-12-01", started: null, done: null, who: "Acme Supply", line: LINE };
  const gr = { kind: "gr", id: "g1", no: "TC-GR-1", status: "RECEIVED", on_hold: false, expected: null, started: null, done: "2026-11-20", who: null, line: LINE };
  const prod = { kind: "production", id: "o1", no: "TC-PRO-1", status: "SUBMITTED", on_hold: false, expected: "2026-12-02", started: null, done: null, who: null, line: LINE };
  const so = { kind: "so", id: "SO-1", no: "SO-1", status: "CONFIRMED", on_hold: false, expected: null, started: "2026-11-01", done: null, who: null, line: LINE };
  const dOrder = { kind: "do", id: "d1", no: "TC-DO-1", status: "LOADED", on_hold: false, expected: "2026-12-05", started: null, done: null, who: null, line: LINE };
  return {
    prepare(sql: string) {
      sqls.push(sql);
      return {
        bind(...a: unknown[]) {
          binds.push(a);
          const rows = [
            ...(sql.includes("FROM sos") ? [so] : []),
            ...(sql.includes("po.po_number") ? [po] : []),
            ...(sql.includes("o.actual_start_at") ? [prod] : []),
            ...(sql.includes("g.grn_number") ? [gr] : []),
            dOrder,
          ];
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
}

beforeEach(() => {
  state.rows = {};
  state.asked = [];
});

describe("renovation doc trail", () => {
  it("a salesperson's chain is the SO and DO only, and the SQL never names a purchase table", async () => {
    const sqls: string[] = []; const binds: unknown[][] = [];
    const res = await appFor(SALES, renovationDocTrail, 1).request("/?kind=so&id=SO-1", {}, { DB: trailDb(sqls, binds) });
    expect(res.status).toBe(200);
    const body = await res.json() as { steps: Array<{ kind: string; who: string | null }> };
    expect(body.steps.map((s) => s.kind)).toEqual(["so", "do"]);
    const select = sqls[0].slice(sqls[0].indexOf("pos AS"));
    expect(select).not.toMatch(/scm\.suppliers|scm\.production_orders|scm\.grns/);
  });

  it("a purchaser still gets the whole chain with the supplier", async () => {
    const sqls: string[] = []; const binds: unknown[][] = [];
    const res = await appFor(PURCHASER, renovationDocTrail, 1).request("/?kind=so&id=SO-1", {}, { DB: trailDb(sqls, binds) });
    const body = await res.json() as { steps: Array<{ kind: string; who: string | null }> };
    expect(body.steps.map((s) => s.kind)).toEqual(["so", "po", "production", "gr", "do"]);
    expect(body.steps[1].who).toBe("Acme Supply");
  });

  it("a salesperson cannot start the chain from a purchase document", async () => {
    for (const kind of ["po", "production", "gr"]) {
      const res = await appFor(SALES, renovationDocTrail, 1).request(`/?kind=${kind}&id=x`, {}, { DB: trailDb([], []) });
      expect(res.status).toBe(403);
    }
    const res = await appFor(PURCHASER, renovationDocTrail, 1).request("/?kind=po&id=p1", {}, { DB: trailDb([], []) });
    expect(res.status).toBe(200);
  });

  it("per line, a salesperson sees the DO and the stock word but no PO number or arrival date", async () => {
    const sqls: string[] = []; const binds: unknown[][] = [];
    const res = await appFor(SALES, renovationDocTrail, 1).request(`/lines?ids=${LINE}`, {}, { DB: trailDb(sqls, binds) });
    expect(res.status).toBe(200);
    const body = await res.json() as { lines: Record<string, { stock: string | null; incomingPo: string | null; eta: string | null; steps: Array<{ kind: string }> }> };
    expect(body.lines[LINE]).toMatchObject({ stock: "po", incomingPo: null, eta: null });
    expect(body.lines[LINE].steps.map((s) => s.kind)).toEqual(["do"]);
    expect(sqls[0]).not.toMatch(/purchase_order|production_order|grn|supplier/);
    expect(binds[0]).toEqual([LINE, 1]);
  });

  it("per line, a purchaser keeps every document and the incoming PO", async () => {
    const binds: unknown[][] = [];
    const res = await appFor(PURCHASER, renovationDocTrail, 1).request(`/lines?ids=${LINE}`, {}, { DB: trailDb([], binds) });
    const body = await res.json() as { lines: Record<string, { incomingPo: string | null; eta: string | null; steps: Array<{ kind: string }> }> };
    expect(body.lines[LINE]).toMatchObject({ incomingPo: "TC-PO-9", eta: "2026-12-01" });
    expect(body.lines[LINE].steps.map((s) => s.kind)).toEqual(["po", "production", "gr", "do"]);
    expect(binds[0]).toEqual([LINE, 1, 1, 1, 1]);
  });
});

describe("document flow", () => {
  it("candidate POs: a salesperson gets none and nothing is read", async () => {
    state.rows = { mfg_sales_order_items: [{ item_code: "A" }], purchase_order_items: [{ purchase_order_id: "p1" }], purchase_orders: [{ id: "p1", po_number: "PO-1", status: "SUBMITTED", po_date: "2026-11-01" }] };
    const res = await appFor(SALES, documentFlow).request("/candidate-pos/SO-1");
    expect(await res.json()).toEqual({ candidates: [] });
    expect(state.asked).toEqual([]);
  });

  it("candidate POs: a purchaser still gets them", async () => {
    state.rows = { mfg_sales_order_items: [{ item_code: "A" }], purchase_order_items: [{ purchase_order_id: "p1" }], purchase_orders: [{ id: "p1", po_number: "PO-1", status: "SUBMITTED", po_date: "2026-11-01" }] };
    const res = await appFor(PURCHASER, documentFlow).request("/candidate-pos/SO-1");
    const body = await res.json() as { candidates: Array<{ poNumber: string }> };
    expect(body.candidates.map((c) => c.poNumber)).toEqual(["PO-1"]);
  });

  it("a salesperson cannot open the map of a purchase document", async () => {
    for (const type of ["po", "grn", "pi", "pr"]) {
      const res = await appFor(SALES, documentFlow).request(`/${type}/x`);
      expect(res.status).toBe(403);
    }
    expect(state.asked).toEqual([]);
    const res = await appFor(PURCHASER, documentFlow).request("/po/x");
    expect(res.status).toBe(200);
  });

  it("a salesperson's map from a sales document loses the purchase nodes, their edges and PO amendments", async () => {
    // An orphan DO (no SO behind it) is the smallest graph the route builds; the filter is the same at both returns.
    const res = await appFor(SALES, documentFlow).request("/do/d1");
    expect(res.status).toBe(200);
    const graph = withoutPurchaseSide({
      nodes: [
        { key: "so:SO-1", type: "so" as const, id: "SO-1", label: "SO-1", status: null, isAnchor: true },
        { key: "po:p1", type: "po" as const, id: "p1", label: "PO-1", status: null, isAnchor: false },
        { key: "grn:g1", type: "grn" as const, id: "g1", label: "GR-1", status: null, isAnchor: false },
        { key: "pi:i1", type: "pi" as const, id: "i1", label: "PI-1", status: null, isAnchor: false },
        { key: "pr:r1", type: "pr" as const, id: "r1", label: "PR-1", status: null, isAnchor: false },
        { key: "do:d1", type: "do" as const, id: "d1", label: "DO-1", status: null, isAnchor: false },
      ],
      edges: [
        { from: "so:SO-1", to: "po:p1", kind: "value" as const, linkage: "provenance" as const },
        { from: "po:p1", to: "grn:g1", kind: "full" as const, linkage: "chain" as const },
        { from: "so:SO-1", to: "do:d1", kind: "full" as const, linkage: "chain" as const },
      ],
      rootSos: ["SO-1"],
      amendments: [{ id: "a1" }],
      poAmendments: [{ id: "pa1" }],
    });
    expect(graph.nodes.map((n) => n.type)).toEqual(["so", "do"]);
    expect(graph.edges).toEqual([{ from: "so:SO-1", to: "do:d1", kind: "full", linkage: "chain" }]);
    expect(graph.poAmendments).toEqual([]);
    expect(graph.amendments).toEqual([{ id: "a1" }]);
  });
});

describe("PO to SO coverage", () => {
  it("is refused to a salesperson and open to a purchaser", async () => {
    expect((await appFor(SALES, new Hono()).request("/po-so-coverage/po/p1")).status).toBe(403);
    expect((await appFor(PURCHASER, new Hono()).request("/po-so-coverage/po/p1")).status).toBe(200);
  });

  it("is guarded on the real /api/scm tree", async () => {
    const { scm } = await import("../src/scm/index");
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("user" as never, SALES as never); await next(); });
    app.route("/", scm);
    expect((await app.request("/po-so-coverage/po/p1", {}, {})).status).toBe(403);
  }, 180_000);
});

describe("global search", () => {
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
  const ctx = (user: Caller) => ({ get: (k: string) => (k === "user" ? user : undefined) });
  const searchRows = () => ({
    mfg_sales_orders: [{ doc_no: "SO-ACME" }],
    purchase_orders: [{ id: "p1", po_number: "PO-ACME", po_date: "2026-11-01", supplier: { name: "Acme Supply" } }],
    grns: [{ id: "g1", grn_number: "GR-ACME", received_at: "2026-11-02" }],
    purchase_invoices: [{ id: "i1", invoice_number: "PI-ACME", invoice_date: "2026-11-03" }],
    delivery_orders: [{ id: "d1", do_number: "DO-ACME", do_date: "2026-11-04" }],
  });

  it("a salesperson's search never reads or returns a purchase document, and does not call them degraded", async () => {
    state.rows = searchRows();
    const out = await runGlobalSearch(ctx(SALES), { DB: db } as never, "acme");
    const types = out.hits.map((h) => h.type);
    expect(types).toContain("sales_order");
    expect(types).toContain("delivery_order");
    expect(types).not.toContain("purchase_order");
    expect(types).not.toContain("grn");
    expect(types).not.toContain("purchase_invoice");
    expect(out.degraded).toEqual([]);
    expect(state.asked).not.toContain("purchase_orders");
    expect(state.asked).not.toContain("grns");
    expect(state.asked).not.toContain("purchase_invoices");
    expect(state.asked).not.toContain("purchase_order_items");
  });

  it("a purchaser's search still finds them", async () => {
    state.rows = searchRows();
    const out = await runGlobalSearch(ctx(PURCHASER), { DB: db } as never, "acme");
    const types = out.hits.map((h) => h.type);
    expect(types).toEqual(expect.arrayContaining(["purchase_order", "grn", "purchase_invoice"]));
  });
});
