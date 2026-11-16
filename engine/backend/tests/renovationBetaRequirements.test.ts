import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import requirements from "../src/routes/renovationBetaRequirements";
import {
  REQUIREMENT_LINE_LIMIT, buildRequirementBoard, type RequirementLineRow, type RequirementProjectRow, type TradePlanRow,
} from "../src/services/renovation/requirementBoard";

const TODAY = "2026-11-16";

function projectRow(overrides: Partial<RequirementProjectRow>): RequirementProjectRow {
  return { project_id: 7, project_code: "RN-0007", project_name: "Baron B11-07", brand: null, ...overrides };
}

function lineRow(overrides: Partial<RequirementLineRow>): RequirementLineRow {
  return {
    id: "line-1", project_id: 7, item_code: "RN-PROTECTION", description: "Works - Protection", remark: null,
    qty: "1", uom: "UNIT", room: "Common area", cat_code: "WORKS", sub_code: "PROTECTION", sub_label: "Protection", is_on_po: false, deliver_on: null,
    ...overrides,
  };
}

function planRow(overrides: Partial<TradePlanRow>): TradePlanRow {
  return {
    id: 1, project_id: 7, trade_code: "ELECTRICAL", category_code: "WIRING_HACKING", label: "WIRING & HACKING", state: "open", fulfilment_kind: "internal",
    planned_start: null, planned_end: null, actual_start: null, actual_end: null, po_fully_received: null,
    ...overrides,
  };
}

function board(lines: RequirementLineRow[], plans: TradePlanRow[] = [], projects: RequirementProjectRow[] = [projectRow({})], scope: Parameters<typeof buildRequirementBoard>[1] = null) {
  return buildRequirementBoard({ projects, lines, plans }, scope, TODAY);
}

function scriptedDb(projects: RequirementProjectRow[], lines: RequirementLineRow[], plans: TradePlanRow[] = []) {
  const ran: string[] = [];
  const answerFor = (sql: string): unknown[] => {
    if (sql.includes("conts_category_access")) return [];
    if (sql.includes("FROM project_trade_tasks")) return plans;
    return sql.includes("mfg_sales_order_items") ? lines : projects;
  };
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    all: async () => {
      ran.push(sql);
      return { results: answerFor(sql) };
    },
  });
  return { ran, database: { prepare: (sql: string) => statement(sql) } };
}

function boardApp(database: unknown, pageAccess: Record<string, string> = { "projects.list": "view" }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 5, email: "office@example.test", permissions: [], page_access: pageAccess } as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/beta", requirements);
  return () => app.request("/api/beta/requirements", { method: "GET" }, { DB: database });
}

describe("requirement board", () => {
  test("a line carries its room, group, qty and PO state, and never a price", () => {
    const [line] = board([lineRow({ remark: " FLOOR PROTECTION ", qty: "20", is_on_po: true, deliver_on: "2026-11-20T00:00:00Z" })]).projects[0].lines;
    expect(line).toEqual({
      id: "line-1", itemCode: "RN-PROTECTION", name: "Works - Protection", remark: "FLOOR PROTECTION",
      qty: 20, uom: "UNIT", room: "Common area", group: "works", isOnPo: true, planKey: "PROTECTION", tradeLabel: "Protection", onSiteBy: "2026-11-20",
    });
  });

  test("Works and Built-in lines are kept; other categories are left out", () => {
    const result = board([
      lineRow({ id: "a", cat_code: "WORKS" }),
      lineRow({ id: "b", cat_code: "BUILTIN" }),
      lineRow({ id: "c", cat_code: "SOFT" }),
    ]);
    expect(result.projects[0].lines.map((line) => [line.id, line.group, line.planKey])).toEqual([["a", "works", "PROTECTION"], ["b", "builtin", "BUILTIN"]]);
  });

  test("a line outside the caller's category access is hidden", () => {
    const scope = { groups: new Set(["WORKS"]), subs: new Set<string>(), other: false };
    const result = board([lineRow({ id: "a" }), lineRow({ id: "b", cat_code: "BUILTIN" })], [], [projectRow({})], scope);
    expect(result.projects[0].lines.map((line) => line.id)).toEqual(["a"]);
  });

  test("projects with lines come first; a project with no sales order is still listed, empty", () => {
    const result = board([lineRow({ project_id: 7 })], [], [projectRow({ project_id: 1, project_name: "Arte" }), projectRow({ project_id: 7, brand: " The Conts " })]);
    expect(result.projects.map((project) => [project.name, project.brand, project.lines.length])).toEqual([["Baron B11-07", "The Conts", 1], ["Arte", null, 0]]);
  });

  test("a full page of lines says the list was cut short", () => {
    const rows = Array.from({ length: REQUIREMENT_LINE_LIMIT }, (_, index) => lineRow({ id: `line-${index}` }));
    expect(board(rows).isTruncated).toBe(true);
  });

  test("a trade task plans its Works trade; carpentry plans the Built-in lines; template and other category tasks plan nothing", () => {
    const { plans } = board([lineRow({})], [
      planRow({ id: 1, planned_start: "2026-11-10", planned_end: "2026-11-12" }),
      planRow({ id: 2, trade_code: "ELECTRICAL", category_code: "LIGHTING_FAN", label: "LIGHTING & FAN INSTALLATION", planned_start: "2026-11-20" }),
      planRow({ id: 3, trade_code: "CAT:CARPENTRY", category_code: "CARPENTRY", label: "CARPENTRY", state: "done" }),
      planRow({ id: 4, trade_code: "CAT:CURTAIN", category_code: "CURTAIN", label: "CURTAIN INSTALLATION" }),
    ]).projects[0];
    expect(plans.map((plan) => [plan.taskId, plan.planKey, plan.status])).toEqual([[1, "ELECTRICAL", "overdue"], [2, "ELECTRICAL", "planned"], [3, "BUILTIN", "done"]]);
    expect(plans[0]).toMatchObject({ label: "WIRING & HACKING", plannedStart: "2026-11-10", plannedEnd: "2026-11-12" });
  });

  test("a subcontracted trade whose PO is fully received reads as done", () => {
    const [plan] = board([lineRow({})], [planRow({ fulfilment_kind: "po", po_fully_received: true })]).projects[0].plans;
    expect(plan.status).toBe("done");
  });
});

describe("GET /api/beta/requirements", () => {
  test("needs a session", async () => {
    const app = new Hono();
    app.route("/api/beta", requirements);
    expect((await app.request("/api/beta/requirements", { method: "GET" }, {})).status).toBe(401);
  });

  test("needs the project list page", async () => {
    const { database } = scriptedDb([], []);
    expect((await boardApp(database, { "projects.defects": "full" })()).status).toBe(403);
  });

  test("reads the active company's live renovation projects, Works and Built-in lines only, with no price column", async () => {
    const { database, ran } = scriptedDb([projectRow({})], [lineRow({})], [planRow({})]);
    const response = await boardApp(database)();
    expect(response.status).toBe(200);
    const board = await response.json();
    expect(board.projects[0].lines.map((line: { id: string }) => line.id)).toEqual(["line-1"]);
    expect(board.projects[0].plans.map((plan: { taskId: number }) => plan.taskId)).toEqual([1]);
    const plansSql = ran.find((sql) => sql.includes("FROM project_trade_tasks")) ?? "";
    expect(plansSql).toContain("t.state <> 'skipped'");
    expect(plansSql).toMatch(/p\.company_id\s*=\s*1/);
    const linesSql = ran.find((sql) => sql.includes("mfg_sales_order_items")) ?? "";
    expect(linesSql).toContain("p.project_kind = 'renovation' AND p.archived_at IS NULL");
    expect(linesSql).toMatch(/p\.company_id\s*=\s*1/);
    expect(linesSql).toContain("cg.code IN ('WORKS', 'BUILTIN')");
    expect(linesSql).not.toMatch(/price|total_sen/);
  });

  test("a failed read answers 500 in words", async () => {
    const database = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("boom"); } }), all: async () => { throw new Error("boom"); } }) };
    const response = await boardApp(database)();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "renovation_read_failed" });
  });
});
