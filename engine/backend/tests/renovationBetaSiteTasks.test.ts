import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import siteTasks from "../src/routes/renovationBetaSiteTasks";
import { MEDIA_ACTION } from "../src/services/renovation/betaMedia";
import { SITE_TASK_LIMIT, buildSiteTaskBoard, type SiteTaskRow } from "../src/services/renovation/siteTaskBoard";

const TODAY = "2026-11-13";

function taskRow(overrides: Partial<SiteTaskRow>): SiteTaskRow {
  return {
    id: 1, project_id: 7, project_code: "RN-0007", project_name: "Vortex A-12-03", building: "Vortex", unit_no: "A-12-03", brand: null,
    label: "Painting", fulfilment_kind: "internal", state: "pending", supplier_name: null, crew: null,
    planned_start: null, planned_end: null, actual_start: null, actual_end: null, po_fully_received: null, last_photo_at: null,
    ...overrides,
  };
}

function recordingDb(rows: SiteTaskRow[]) {
  const ran: Array<{ sql: string; args: unknown[] }> = [];
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    all: async () => {
      ran.push({ sql, args });
      return { results: rows };
    },
  });
  return { ran, database: { prepare: (sql: string) => statement(sql) } };
}

function boardApp(database: unknown, pageAccess: Record<string, string> = { "projects.list": "view" }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 5, permissions: [], page_access: pageAccess } as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/beta", siteTasks);
  return () => app.request("/api/beta/site-tasks", { method: "GET" }, { DB: database });
}

describe("site task board", () => {
  test("open tasks sort by planned date with undated last; finished tasks go to history, latest first", () => {
    const board = buildSiteTaskBoard([
      taskRow({ id: 1, planned_start: "2026-11-20" }),
      taskRow({ id: 2 }),
      taskRow({ id: 3, planned_start: "2026-11-10", planned_end: "2026-11-18" }),
      taskRow({ id: 4, state: "done", actual_end: "2026-11-01" }),
      taskRow({ id: 5, state: "skipped" }),
      taskRow({ id: 6, state: "done", actual_end: "2026-11-09" }),
    ], TODAY);
    expect(board.open.map((task) => task.id)).toEqual([3, 1, 2]);
    expect(board.history.map((task) => task.id)).toEqual([6, 4, 5]);
    expect(board.isTruncated).toBe(false);
  });

  test("a subcontracted task whose PO is fully received counts as done", () => {
    const board = buildSiteTaskBoard([taskRow({ fulfilment_kind: "po", supplier_name: "Ah Seng Tiling", po_fully_received: true })], TODAY);
    expect(board.open).toEqual([]);
    expect(board.history[0]).toMatchObject({ status: "done", isSubcontracted: true, supplierName: "Ah Seng Tiling" });
  });

  test("an in-house task names its crew and never a supplier", () => {
    const [task] = buildSiteTaskBoard([
      taskRow({ supplier_name: "Left over", brand: " Dream Crafter ", crew: [{ id: 3, name: "Ali" }], planned_start: "2026-11-01", planned_end: "2026-11-10" }),
    ], TODAY).open;
    expect(task).toMatchObject({ brand: "Dream Crafter", isSubcontracted: false, supplierName: null, crew: [{ id: 3, name: "Ali" }], status: "overdue" });
  });

  test("a full page of rows says the list was cut short", () => {
    const rows = Array.from({ length: SITE_TASK_LIMIT }, (_, index) => taskRow({ id: index + 1 }));
    expect(buildSiteTaskBoard(rows, TODAY).isTruncated).toBe(true);
  });
});

describe("GET /api/beta/site-tasks", () => {
  test("needs a session", async () => {
    const app = new Hono();
    app.route("/api/beta", siteTasks);
    expect((await app.request("/api/beta/site-tasks", { method: "GET" }, {})).status).toBe(401);
  });

  test("needs the project list page", async () => {
    const { database } = recordingDb([]);
    expect((await boardApp(database, { "projects.defects": "full" })()).status).toBe(403);
  });

  test("reads only the active company's live renovation projects and answers the board", async () => {
    const { database, ran } = recordingDb([taskRow({ id: 9, planned_start: "2026-11-14" })]);
    const response = await boardApp(database)();
    expect(response.status).toBe(200);
    const board = await response.json();
    expect(board.open.map((task: { id: number }) => task.id)).toEqual([9]);
    expect(ran).toHaveLength(1);
    expect(ran[0].sql).toContain("p.project_kind = 'renovation' AND p.archived_at IS NULL");
    expect(ran[0].sql).toContain("p.brand");
    expect(ran[0].sql).toMatch(/p\.company_id\s*=\s*1/);
    expect(ran[0].args).toEqual([MEDIA_ACTION]);
  });

  test("a failed read answers 500 in words", async () => {
    const database = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("boom"); } }) }) };
    const response = await boardApp(database)();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "renovation_read_failed" });
  });
});
