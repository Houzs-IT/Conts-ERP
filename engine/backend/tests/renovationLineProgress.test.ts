import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import requirements from "../src/routes/renovationBetaRequirements";
import { doneQtyRefusal, reopenLineTrade, setLineDoneQty, type LineActor, type ProgressLine, type TradeTaskRow } from "../src/services/renovation/lineProgress";

const ACTOR: LineActor = { userId: 5, personId: null, companySql: " AND p.company_id = 1", today: "2026-11-16" };

interface Script {
  line?: ProgressLine | null;
  remaining?: number;
  tasks?: TradeTaskRow[];
  poLinkedTaskIds?: number[];
  missingTable?: boolean;
}

function scriptedDb(script: Script) {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const answer = (sql: string, args: unknown[]) => {
    if (script.missingTable && sql.includes("project_line_progress")) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (sql.includes("count(*)::int AS remaining")) return { remaining: script.remaining ?? 0 };
    if (sql.includes("project_trade_task_lines")) return script.poLinkedTaskIds?.includes(Number(args[0])) ? { x: 1 } : null;
    if (sql.includes("i.id::text = ?")) return script.line ?? null;
    return null;
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => answer(sql, args),
    all: async () => ({ results: sql.includes("FROM project_trade_tasks t") ? script.tasks ?? [] : [] }),
    run: async () => {
      runs.push({ sql, args });
      return {};
    },
  });
  return { runs, database: { prepare: (sql: string) => statement(sql) } };
}

const worksLine = (overrides: Partial<ProgressLine> = {}): ProgressLine => ({
  id: "line-1", project_id: 13, company_id: 1, cat_code: "WORKS", sub_code: "ELECTRICAL", qty: "3", done_qty: null, ...overrides,
});
const task = (overrides: Partial<TradeTaskRow>): TradeTaskRow => ({ id: 1, trade_code: "ELECTRICAL", fulfilment_kind: "internal", state: "open", ...overrides });
const taskUpdates = (runs: Array<{ sql: string; args: unknown[] }>): unknown[] =>
  runs.filter((run) => run.sql.includes("UPDATE project_trade_tasks SET state = 'done'")).map((run) => run.args.at(-1));

describe("units done on a line", () => {
  test("a part count is saved and closes nothing", async () => {
    const { database, runs } = scriptedDb({ line: worksLine(), tasks: [task({})] });
    expect(await setLineDoneQty(database, "line-1", 2, ACTOR)).toEqual({ projectId: 13, previousDoneQty: 0, doneQty: 2 });
    expect(runs[0].sql).toContain("INSERT INTO project_line_progress");
    expect(runs[0].args).toEqual(["line-1", 13, 1, 2, 5, null]);
    expect(taskUpdates(runs)).toEqual([]);
  });

  test("the full count on the last unfinished line no longer closes the trade", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "2" }), remaining: 0, tasks: [task({ id: 1 }), task({ id: 2, state: "done" })] });
    expect(await setLineDoneQty(database, "line-1", 3, ACTOR)).toEqual({ projectId: 13, previousDoneQty: 2, doneQty: 3 });
    expect(taskUpdates(runs)).toEqual([]);
  });

  test("a Built-in line saved to full leaves the carpentry task open too", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ cat_code: "BUILTIN", sub_code: "WARDROBE", qty: "1" }), remaining: 0, tasks: [task({ id: 7, trade_code: "CAT:CARPENTRY" })] });
    expect(await setLineDoneQty(database, "line-1", 1, ACTOR)).toMatchObject({ doneQty: 1 });
    expect(taskUpdates(runs)).toEqual([]);
  });

  test("zero deletes the row", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "2" }), tasks: [task({})] });
    expect(await setLineDoneQty(database, "line-1", 0, ACTOR)).toMatchObject({ previousDoneQty: 2, doneQty: 0 });
    expect(runs.map((run) => run.sql)).toEqual([expect.stringContaining("DELETE FROM project_line_progress")]);
  });

  test("a count cannot go down once the trade is done, but can go up", async () => {
    const lowered = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ state: "done" })] });
    expect(await setLineDoneQty(lowered.database, "line-1", 2, ACTOR)).toBe("trade_complete");
    expect(lowered.runs).toEqual([]);
    const raised = scriptedDb({ line: worksLine({ done_qty: "1" }), remaining: 1, tasks: [task({ state: "done" })] });
    expect(await setLineDoneQty(raised.database, "line-1", 2, ACTOR)).toMatchObject({ doneQty: 2 });
  });

  test("a count outside 0 to the line's qty, or not a number, is refused", () => {
    expect([doneQtyRefusal(-1, 3), doneQtyRefusal(4, 3), doneQtyRefusal(Number.NaN, 3), doneQtyRefusal(1.5, 3)]).toEqual(["invalid_qty", "invalid_qty", "invalid_qty", null]);
  });

  test("a line that is not a live Works or Built-in line is refused", async () => {
    const { database, runs } = scriptedDb({ line: null });
    expect(await setLineDoneQty(database, "nope", 1, ACTOR)).toBe("line_not_found");
    expect(runs).toEqual([]);
  });
});

describe("reopening a line's trade", () => {
  const reopens = (runs: Array<{ sql: string; args: unknown[] }>): unknown[] =>
    runs.filter((run) => run.sql.includes("SET state = 'in_progress', done_at = NULL")).map((run) => run.args.at(-1));

  test("sets each done task of the trade back to in progress and leaves the others", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ id: 1, state: "done" }), task({ id: 2, state: "open" }), task({ id: 3, state: "done" })] });
    expect(await reopenLineTrade(database, "line-1", ACTOR.companySql)).toEqual({ projectId: 13, reopenedTasks: [task({ id: 1, state: "done" }), task({ id: 3, state: "done" })] });
    expect(reopens(runs)).toEqual([1, 3]);
  });

  test("a trade with nothing done reopens nothing", async () => {
    const { database, runs } = scriptedDb({ line: worksLine(), tasks: [task({})] });
    expect(await reopenLineTrade(database, "line-1", ACTOR.companySql)).toMatchObject({ reopenedTasks: [] });
    expect(runs).toEqual([]);
  });

  test("a task closed by a purchase order receipt is not reopened", async () => {
    const { database, runs } = scriptedDb({ line: worksLine(), tasks: [task({ id: 1, state: "done" }), task({ id: 2, state: "done", fulfilment_kind: "po" })], poLinkedTaskIds: [2] });
    expect(await reopenLineTrade(database, "line-1", ACTOR.companySql)).toBe("po_receipt");
    expect(runs).toEqual([]);
  });

  test("a line that is not a live Works or Built-in line is refused", async () => {
    const { database } = scriptedDb({ line: null });
    expect(await reopenLineTrade(database, "nope", ACTOR.companySql)).toBe("line_not_found");
  });
});

function routeApp(database: unknown, permissions: string[] = ["projects.write"], path = "/api/beta/requirements/lines/line-1/progress", method = "PUT") {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 5, email: "office@example.test", permissions, page_access: { "projects.list": "view" } } as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/beta", requirements);
  return (body: unknown) => app.request(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }, { DB: database });
}

describe("progress route", () => {
  test("needs projects.write", async () => {
    const { database } = scriptedDb({ line: worksLine() });
    expect((await routeApp(database, [])({ doneQty: 1 })).status).toBe(403);
  });

  test("answers the saved count and closes no task", async () => {
    const { database } = scriptedDb({ line: worksLine(), remaining: 0, tasks: [task({ id: 3 })] });
    const response = await routeApp(database)({ doneQty: 3 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, previousDoneQty: 0, doneQty: 3, completedTaskIds: [] });
  });

  test("refuses a count that is not a number in words", async () => {
    const { database } = scriptedDb({ line: worksLine() });
    const response = await routeApp(database)({ doneQty: "3" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_qty" });
  });

  test("refuses to lower a done trade's line in words", async () => {
    const { database } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ state: "done" })] });
    const response = await routeApp(database)({ doneQty: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "trade_complete" });
  });

  test("one save reopens a closed trade and lowers the count, and logs the reopening", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ id: 3, state: "done" })] });
    const response = await routeApp(database)({ doneQty: 1, shouldReopenTrade: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, previousDoneQty: 3, doneQty: 1, completedTaskIds: [], didReopenTrade: true });
    const order = runs.map((run) => (run.sql.includes("SET state = 'in_progress'") ? "reopen" : run.sql.includes("INSERT INTO project_line_progress") ? "count" : run.sql.includes("task_reopened") || run.args.includes("task_reopened") ? "log" : "other"));
    expect(order.filter((step) => step !== "other")).toEqual(["reopen", "count", "log"]);
  });

  test("a lower count on a closed trade is still refused unless the call asks to reopen it", async () => {
    const { database } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ state: "done" })] });
    expect((await routeApp(database)({ doneQty: 1, shouldReopenTrade: false })).status).toBe(409);
  });

  test("asking to reopen does nothing when the count goes up or the trade is open", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "1" }), remaining: 1, tasks: [task({ state: "done" })] });
    const response = await routeApp(database)({ doneQty: 2, shouldReopenTrade: true });
    expect(await response.json()).toEqual({ ok: true, previousDoneQty: 1, doneQty: 2, completedTaskIds: [] });
    expect(runs.some((run) => run.sql.includes("SET state = 'in_progress'"))).toBe(false);
  });

  test("a trade closed by a PO receipt cannot be reopened by a lower count", async () => {
    const { database, runs } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ id: 2, state: "done", fulfilment_kind: "po" })], poLinkedTaskIds: [2] });
    const response = await routeApp(database)({ doneQty: 1, shouldReopenTrade: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "po_receipt" });
    expect(runs).toEqual([]);
  });

  test("reopen answers the tasks it reopened and needs projects.write", async () => {
    const { database } = scriptedDb({ line: worksLine({ done_qty: "3" }), tasks: [task({ id: 3, state: "done" })] });
    const reopen = (permissions: string[]) => routeApp(database, permissions, "/api/beta/requirements/lines/line-1/reopen", "POST")({});
    expect((await reopen([])).status).toBe(403);
    const response = await reopen(["projects.write"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, reopenedTaskIds: [3] });
  });

  test("says progress is not switched on before the migration", async () => {
    const { database } = scriptedDb({ line: worksLine(), missingTable: true });
    const response = await routeApp(database)({ doneQty: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "progress_not_ready" });
  });
});
