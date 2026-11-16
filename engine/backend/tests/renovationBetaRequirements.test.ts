import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import requirements from "../src/routes/renovationBetaRequirements";
import {
  REQUIREMENT_LINE_LIMIT, buildRequirementBoard, type RequirementLineRow, type RequirementProjectRow,
} from "../src/services/renovation/requirementBoard";

function projectRow(overrides: Partial<RequirementProjectRow>): RequirementProjectRow {
  return { project_id: 7, project_code: "RN-0007", project_name: "Baron B11-07", brand: null, ...overrides };
}

function lineRow(overrides: Partial<RequirementLineRow>): RequirementLineRow {
  return {
    id: "line-1", project_id: 7, item_code: "RN-PROTECTION", description: "Works - Protection", remark: null,
    qty: "1", uom: "UNIT", room: "Common area", cat_code: "WORKS", sub_code: "PROTECTION", is_on_po: false,
    ...overrides,
  };
}

function scriptedDb(projects: RequirementProjectRow[], lines: RequirementLineRow[]) {
  const ran: string[] = [];
  const answerFor = (sql: string): unknown[] => {
    if (sql.includes("conts_category_access")) return [];
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
    const [line] = buildRequirementBoard([projectRow({})], [lineRow({ remark: " FLOOR PROTECTION ", qty: "20", is_on_po: true })], null).projects[0].lines;
    expect(line).toEqual({
      id: "line-1", itemCode: "RN-PROTECTION", name: "Works - Protection", remark: "FLOOR PROTECTION",
      qty: 20, uom: "UNIT", room: "Common area", group: "works", isOnPo: true,
    });
  });

  test("Works and Built-in lines are kept; other categories are left out", () => {
    const board = buildRequirementBoard([projectRow({})], [
      lineRow({ id: "a", cat_code: "WORKS" }),
      lineRow({ id: "b", cat_code: "BUILTIN" }),
      lineRow({ id: "c", cat_code: "SOFT" }),
    ], null);
    expect(board.projects[0].lines.map((line) => [line.id, line.group])).toEqual([["a", "works"], ["b", "builtin"]]);
  });

  test("a line outside the caller's category access is hidden", () => {
    const scope = { groups: new Set(["WORKS"]), subs: new Set<string>(), other: false };
    const board = buildRequirementBoard([projectRow({})], [lineRow({ id: "a" }), lineRow({ id: "b", cat_code: "BUILTIN" })], scope);
    expect(board.projects[0].lines.map((line) => line.id)).toEqual(["a"]);
  });

  test("projects with lines come first; a project with no sales order is still listed, empty", () => {
    const board = buildRequirementBoard(
      [projectRow({ project_id: 1, project_name: "Arte" }), projectRow({ project_id: 7, brand: " The Conts " })],
      [lineRow({ project_id: 7 })],
      null,
    );
    expect(board.projects.map((project) => [project.name, project.brand, project.lines.length])).toEqual([["Baron B11-07", "The Conts", 1], ["Arte", null, 0]]);
  });

  test("a full page of lines says the list was cut short", () => {
    const rows = Array.from({ length: REQUIREMENT_LINE_LIMIT }, (_, index) => lineRow({ id: `line-${index}` }));
    expect(buildRequirementBoard([projectRow({})], rows, null).isTruncated).toBe(true);
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
    const { database, ran } = scriptedDb([projectRow({})], [lineRow({})]);
    const response = await boardApp(database)();
    expect(response.status).toBe(200);
    const board = await response.json();
    expect(board.projects[0].lines.map((line: { id: string }) => line.id)).toEqual(["line-1"]);
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
