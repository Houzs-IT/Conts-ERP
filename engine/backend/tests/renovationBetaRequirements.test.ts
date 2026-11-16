import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import requirements from "../src/routes/renovationBetaRequirements";
import type { TradeMediaRow } from "../src/services/renovation/tradeLog";
import {
  REQUIREMENT_LINE_LIMIT, buildRequirementBoard, type LineProofRow, type RequirementLineRow, type RequirementProjectRow, type TradePlanRow,
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
  return buildRequirementBoard({ projects, lines, plans, ticks: [] }, scope, TODAY);
}

function scriptedDb(projects: RequirementProjectRow[], lines: RequirementLineRow[], plans: TradePlanRow[] = [], proofs: LineProofRow[] = [], tradeMedia: TradeMediaRow[] = []) {
  const ran: string[] = [];
  const answerFor = (sql: string): unknown[] => {
    if (sql.includes("conts_category_access")) return [];
    if (sql.includes("'task:%'")) return tradeMedia;
    if (sql.includes("beta_media")) return proofs;
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
      qty: 20, uom: "UNIT", room: "Common area", group: "works", isOnPo: true, planKey: "PROTECTION", tradeLabel: "Protection", onSiteBy: "2026-11-20", doneQty: 0, doneAt: null, isTradeClosed: false,
      photoCount: 0, latestPhotoKeys: [], latestPhotoBy: null,
    });
  });

  test("a line knows when its trade's site task is done, by the task's state", () => {
    const lines = [lineRow({ id: "a", sub_code: "ELECTRICAL" }), lineRow({ id: "b", sub_code: "PROTECTION" }), lineRow({ id: "c", cat_code: "BUILTIN", sub_code: "WARDROBE" })];
    const plans = [
      planRow({ id: 1, trade_code: "ELECTRICAL", state: "open" }),
      planRow({ id: 2, trade_code: "ELECTRICAL", category_code: "LIGHTING_FAN", state: "done" }),
      planRow({ id: 3, trade_code: "CAT:CARPENTRY", category_code: "CARPENTRY", state: "done" }),
      planRow({ id: 4, trade_code: "PROTECTION", state: "in_progress", actual_end: "2026-11-16" }),
    ];
    expect(board(lines, plans).projects[0].lines.map((line) => [line.id, line.isTradeClosed])).toEqual([["a", true], ["b", false], ["c", true]]);
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

  test("a line carries its units done, and a done date only once every unit is done", () => {
    const rows = (doneQty: string) => ({ projects: [projectRow({})], lines: [lineRow({ qty: "3" })], plans: [], ticks: [{ so_item_id: "line-1", done_at: "2026-11-16T03:00:00Z", done_qty: doneQty }] });
    expect(buildRequirementBoard(rows("2"), null, TODAY).projects[0].lines[0]).toMatchObject({ doneQty: 2, doneAt: null });
    expect(buildRequirementBoard(rows("3"), null, TODAY).projects[0].lines[0]).toMatchObject({ doneQty: 3, doneAt: "2026-11-16T03:00:00Z" });
  });

  test("a line carries its proof photo count, the newest keys and who sent the latest", () => {
    const proofs: LineProofRow[] = [
      { target: "line:0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10", key: "renovation/7/proof-3.jpg", note: JSON.stringify({ name: "c.jpg", by: "Ah Seng" }), total: 3 },
      { target: "line:0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10", key: "renovation/7/proof-2.jpg", note: null, total: 3 },
      { target: "line:0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10", key: "renovation/7/proof-1.jpg", note: null, total: 3 },
      { target: "defect:4:before", key: "renovation/7/other.jpg", note: null, total: 1 },
    ];
    const rows = { projects: [projectRow({})], lines: [lineRow({ id: "0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10" }), lineRow({ id: "line-2" })], plans: [], ticks: [], proofs };
    const [withPhotos, without] = buildRequirementBoard(rows, null, TODAY).projects[0].lines;
    expect(withPhotos).toMatchObject({ photoCount: 3, latestPhotoKeys: ["renovation/7/proof-3.jpg", "renovation/7/proof-2.jpg", "renovation/7/proof-1.jpg"], latestPhotoBy: "Ah Seng" });
    expect(without).toMatchObject({ photoCount: 0, latestPhotoKeys: [], latestPhotoBy: null });
  });

  test("a plan reads its state, start day and a crew finish held by a PO", () => {
    const plans = [
      planRow({ id: 1, trade_code: "ELECTRICAL" }),
      planRow({ id: 2, trade_code: "PROTECTION", state: "in_progress", actual_start: "2026-11-14" }),
      planRow({ id: 3, trade_code: "PAINTING", state: "done", actual_start: "2026-11-10", actual_end: "2026-11-12" }),
      planRow({ id: 4, trade_code: "CAT:CARPENTRY", category_code: "CARPENTRY", state: "in_progress", fulfilment_kind: "po", po_fully_received: false }),
    ];
    const tradeMedia = [{ project_id: 7, target: "task:4", day: "2026-11-16", note: JSON.stringify({ name: "a.jpg", stage: "finish", by: "Ali" }) }];
    const rows = { projects: [projectRow({})], lines: [lineRow({})], plans, ticks: [], tradeMedia };
    expect(buildRequirementBoard(rows, null, TODAY).projects[0].plans.map((plan) => [plan.taskId, plan.state, plan.startedOn, plan.isWaitingForReceipt])).toEqual([
      [1, "open", null, false], [2, "in_progress", "2026-11-14", false], [3, "done", "2026-11-10", false], [4, "in_progress", null, true],
    ]);
  });

  test("the trade log groups photos by Malaysia day, newest first, counting days from the start", () => {
    const note = (by: string): string => JSON.stringify({ name: "a.jpg", by });
    const tradeMedia = [
      { project_id: 7, target: "task:1", day: "2026-11-14", note: note("Ali") },
      { project_id: 7, target: "line:a", day: "2026-11-16", note: note("Ali") },
      { project_id: 7, target: "line:a", day: "2026-11-16", note: note("Kumar") },
      { project_id: 7, target: "line:b", day: "2026-11-16", note: note("Ali") },
      { project_id: 8, target: "task:1", day: "2026-11-15", note: null },
    ];
    const lines = [lineRow({ id: "a", sub_code: "ELECTRICAL" }), lineRow({ id: "b", sub_code: "ELECTRICAL" })];
    const plans = [planRow({ id: 1, state: "in_progress", actual_start: "2026-11-14" })];
    const { tradeLog } = buildRequirementBoard({ projects: [projectRow({})], lines, plans, ticks: [], tradeMedia }, null, TODAY).projects[0];
    expect(tradeLog).toEqual([{
      planKey: "ELECTRICAL",
      days: [
        { day: 3, date: "2026-11-16", updateCount: 2, photoCount: 3, by: ["Ali", "Kumar"] },
        { day: 1, date: "2026-11-14", updateCount: 1, photoCount: 1, by: ["Ali"] },
      ],
    }]);
  });

  test("the board reads every trade's photos in one query, by Malaysia day", async () => {
    const { database, ran } = scriptedDb([projectRow({})], [lineRow({})]);
    await boardApp(database)();
    const logSql = ran.filter((sql) => sql.includes("'task:%'"));
    expect(logSql).toHaveLength(1);
    expect(logSql[0]).toContain("a.created_at::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur'");
    expect(logSql[0]).toMatch(/p\.company_id\s*=\s*1/);
  });

  test("no progress table reads as not switched on, with nothing done", () => {
    const notReady = buildRequirementBoard({ projects: [projectRow({})], lines: [lineRow({})], plans: [], ticks: null }, null, TODAY);
    expect([notReady.areTicksReady, notReady.projects[0].lines[0].doneQty]).toEqual([false, 0]);
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

  test("the board reads every line's photos in one query, with the company and live-project rules", async () => {
    const { database, ran } = scriptedDb([projectRow({})], [lineRow({})]);
    await boardApp(database)();
    const proofSql = ran.filter((sql) => sql.includes("beta_media") && !sql.includes("'task:%'"));
    expect(proofSql).toHaveLength(1);
    expect(proofSql[0]).toMatch(/p\.company_id\s*=\s*1/);
    expect(proofSql[0]).toContain("p.archived_at IS NULL");
  });

  test("a failed read answers 500 in words", async () => {
    const database = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("boom"); } }), all: async () => { throw new Error("boom"); } }) };
    const response = await boardApp(database)();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "renovation_read_failed" });
  });
});
