import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import requirements from "../src/routes/renovationBetaRequirements";
import { tickLine, untickLine, type LineActor, type TickedLine, type TradeTaskRow } from "../src/services/renovation/lineProgress";

const ACTOR: LineActor = { userId: 5, personId: null, companySql: " AND p.company_id = 1", today: "2026-11-16" };

interface Script {
  line?: TickedLine | null;
  remaining?: number;
  tasks?: TradeTaskRow[];
  poLinkedTaskIds?: number[];
  missingTable?: boolean;
}

function scriptedDb(script: Script) {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const answer = (sql: string, args: unknown[]) => {
    if (sql.includes("count(*)::int AS remaining")) return { remaining: script.remaining ?? 0 };
    if (sql.includes("project_trade_task_lines")) return script.poLinkedTaskIds?.includes(Number(args[0])) ? { x: 1 } : null;
    if (sql.includes("FROM scm.mfg_sales_order_items i") && sql.includes("i.id::text = ?")) return script.line ?? null;
    return null;
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => answer(sql, args),
    all: async () => ({ results: sql.includes("FROM project_trade_tasks t") ? script.tasks ?? [] : [] }),
    run: async () => {
      if (script.missingTable && sql.includes("project_line_progress")) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
      runs.push({ sql, args });
      return {};
    },
  });
  return { runs, database: { prepare: (sql: string) => statement(sql) } };
}

const worksLine: TickedLine = { id: "line-1", project_id: 13, company_id: 1, cat_code: "WORKS", sub_code: "ELECTRICAL" };
const builtInLine: TickedLine = { id: "line-2", project_id: 13, company_id: 1, cat_code: "BUILTIN", sub_code: "WARDROBE" };
const task = (overrides: Partial<TradeTaskRow>): TradeTaskRow => ({ id: 1, trade_code: "ELECTRICAL", fulfilment_kind: "internal", state: "open", ...overrides });

describe("ticking a line", () => {
  test("the last unticked line of a trade completes its open in-house tasks", async () => {
    const { database, runs } = scriptedDb({ line: worksLine, remaining: 0, tasks: [task({ id: 1 }), task({ id: 2, state: "done" })] });
    const outcome = await tickLine(database, "line-1", ACTOR);
    expect(outcome).toEqual({ projectId: 13, completedTasks: [task({ id: 1 })] });
    expect(runs[0].sql).toContain("INSERT INTO project_line_progress");
    expect(runs[0].args).toEqual(["line-1", 13, 1, 5, null]);
    expect(runs.filter((run) => run.sql.includes("UPDATE project_trade_tasks SET state = 'done'")).map((run) => run.args.at(-1))).toEqual([1]);
  });

  test("a trade with lines still unticked completes nothing", async () => {
    const { database, runs } = scriptedDb({ line: worksLine, remaining: 2, tasks: [task({})] });
    expect(await tickLine(database, "line-1", ACTOR)).toEqual({ projectId: 13, completedTasks: [] });
    expect(runs.some((run) => run.sql.includes("UPDATE project_trade_tasks"))).toBe(false);
  });

  test("a subcontracted trade with PO lines waits for its goods, even when every line is ticked", async () => {
    const { database } = scriptedDb({ line: worksLine, remaining: 0, tasks: [task({ fulfilment_kind: "po" })], poLinkedTaskIds: [1] });
    expect(await tickLine(database, "line-1", ACTOR)).toEqual({ projectId: 13, completedTasks: [] });
  });

  test("Built-in lines complete the carpentry task, matched by its category", async () => {
    const { database } = scriptedDb({ line: builtInLine, remaining: 0, tasks: [task({ id: 7, trade_code: "CAT:CARPENTRY" })] });
    const outcome = await tickLine(database, "line-2", ACTOR);
    expect(outcome !== "line_not_found" && outcome.completedTasks.map((done) => done.id)).toEqual([7]);
  });

  test("a line that is not a live Works or Built-in line is refused", async () => {
    const { database, runs } = scriptedDb({ line: null });
    expect(await tickLine(database, "nope", ACTOR)).toBe("line_not_found");
    expect(runs).toEqual([]);
  });
});

describe("unticking a line", () => {
  test("is allowed while the trade is open, and deletes the tick", async () => {
    const { database, runs } = scriptedDb({ line: worksLine, tasks: [task({})] });
    expect(await untickLine(database, "line-1", ACTOR)).toEqual({ projectId: 13 });
    expect(runs.map((run) => run.sql)).toEqual([expect.stringContaining("DELETE FROM project_line_progress")]);
  });

  test("is refused once the trade is done", async () => {
    const { database, runs } = scriptedDb({ line: worksLine, tasks: [task({ state: "done" })] });
    expect(await untickLine(database, "line-1", ACTOR)).toBe("trade_complete");
    expect(runs).toEqual([]);
  });
});

function routeApp(database: unknown, permissions: string[] = ["projects.write"]) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { id: 5, email: "office@example.test", permissions, page_access: { "projects.list": "view" } } as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/beta", requirements);
  return (method: string) => app.request("/api/beta/requirements/lines/line-1/done", { method }, { DB: database });
}

describe("tick routes", () => {
  test("need projects.write", async () => {
    const { database } = scriptedDb({ line: worksLine });
    expect((await routeApp(database, [])("PUT")).status).toBe(403);
  });

  test("answer the completed tasks", async () => {
    const { database } = scriptedDb({ line: worksLine, remaining: 0, tasks: [task({ id: 3 })] });
    const response = await routeApp(database)("PUT");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, completedTaskIds: [3] });
  });

  test("say ticks are not switched on before the migration", async () => {
    const { database } = scriptedDb({ line: worksLine, missingTable: true });
    const response = await routeApp(database)("PUT");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "ticks_not_ready" });
  });

  test("refuse to untick a done trade in words", async () => {
    const { database } = scriptedDb({ line: worksLine, tasks: [task({ state: "done" })] });
    const response = await routeApp(database)("DELETE");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "trade_complete" });
  });
});
