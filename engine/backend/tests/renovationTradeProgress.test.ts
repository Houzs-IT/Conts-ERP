import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import siteForward from "../src/conts/site-forward-routes";
import type { Staff } from "../src/conts/staff-identity";

const RENOVATOR: Staff = { userId: "u-reno", name: "Ah Seng", email: "seng@example.test", departmentId: null, side: null, role: "renovator", field: false };
const PHOTO = { name: "IMG_1.jpg", mime: "image/jpeg", dataBase64: btoa("pretend-jpeg-bytes") };

interface TaskRow {
  id: number;
  project_id: number;
  company_id: number;
  trade_code: string;
  category_code: string | null;
  fulfilment_kind: string;
  state: string;
  actual_start: string | null;
}

interface Script {
  brand?: string;
  task?: TaskRow | null;
  siblings?: TaskRow[];
  lines?: Array<{ id: string; qty: string }>;
  poLinkedTaskIds?: number[];
}

interface Call {
  sql: string;
  args: unknown[];
}

const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: 1, project_id: 13, company_id: 1, trade_code: "ELECTRICAL", category_code: "WIRING_HACKING", fulfilment_kind: "internal", state: "open", actual_start: null, ...overrides,
});

function scriptedDb(script: Script) {
  const calls: Call[] = [];
  const answerFirst = (sql: string, args: unknown[]): unknown => {
    if (sql.includes("public.conts_renovators")) return { brand_name: script.brand ?? "The Conts" };
    if (sql.includes("WHERE t.id = ?")) return script.task === undefined ? taskRow() : script.task;
    if (sql.includes("project_trade_task_lines")) return script.poLinkedTaskIds?.includes(Number(args[0])) ? { x: 1 } : null;
    if (sql.includes("FROM project_people")) return { id: 42 };
    if (sql.includes("count(*)::int AS photo_count")) return { photo_count: 1 };
    return null;
  };
  const answerAll = (sql: string): unknown[] => {
    if (sql.includes("WHERE t.project_id = ?")) return script.siblings ?? [script.task ?? taskRow()];
    if (sql.includes("coalesce(lp.done_qty, 0) < i.qty")) return script.lines ?? [];
    return [];
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => { calls.push({ sql, args }); return answerFirst(sql, args); },
    all: async () => { calls.push({ sql, args }); return { results: answerAll(sql) }; },
    run: async () => { calls.push({ sql, args }); return {}; },
  });
  const stored: string[] = [];
  const bucket = { put: async (key: string) => { stored.push(key); } };
  return { calls, stored, bucket, database: { prepare: (sql: string) => statement(sql) } };
}

function crewApp(database: unknown, bucket: unknown) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("staff" as never, RENOVATOR as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/site-forward", siteForward);
  const post = (path: string, body: unknown) => app.request(`/api/site-forward/trades/${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, { DB: database, POD_BUCKET: bucket });
  return { start: (id: number | string, body: unknown) => post(`${id}/start`, body), finish: (id: number | string, body: unknown) => post(`${id}/finish`, body) };
}

const writes = (calls: Call[]): Call[] => calls.filter((call) => /^\s*(UPDATE|INSERT|DELETE)/i.test(call.sql));
const mediaRows = (calls: Call[]): Call[] => calls.filter((call) => call.sql.includes("jsonb_to_recordset") && call.sql.includes("beta_media"));
const firstMeta = (call: Call): unknown => JSON.parse((JSON.parse(String(call.args[3])) as Array<{ meta: string }>)[0].meta);

describe("start work on a trade", () => {
  test("needs a photo, and writes nothing without one", async () => {
    const { database, bucket, calls } = scriptedDb({});
    const response = await crewApp(database, bucket).start(1, { photos: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "photo_required" });
    expect(writes(calls)).toEqual([]);
  });

  test("starts every not-yet-started task of the trade, then writes the before photos with their stage", async () => {
    const siblings = [taskRow({ id: 1 }), taskRow({ id: 2, state: "in_progress", actual_start: "2026-11-14" }), taskRow({ id: 3 })];
    const { database, bucket, calls, stored } = scriptedDb({ siblings });
    const response = await crewApp(database, bucket).start(1, { photos: [PHOTO] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, startedOn: "2026-11-14" });
    const starts = calls.filter((call) => call.sql.includes("SET state = 'in_progress'"));
    expect(starts.map((call) => call.args.at(-1))).toEqual([1, 3]);
    expect(stored).toHaveLength(1);
    const rows = mediaRows(calls);
    expect(rows).toHaveLength(1);
    expect(rows[0].args.slice(0, 3)).toEqual([13, "task:1", 1]);
    expect(firstMeta(rows[0])).toMatchObject({ stage: "start", by: "Ah Seng" });
    expect(calls.findIndex((call) => call.sql.includes("SET state = 'in_progress'"))).toBeLessThan(calls.findIndex((call) => call.sql.includes("beta_media")));
  });

  test("a done trade is refused and nothing is written", async () => {
    const { database, bucket, calls, stored } = scriptedDb({ siblings: [taskRow({ state: "done" })] });
    const response = await crewApp(database, bucket).start(1, { photos: [PHOTO] });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "trade_done", message: "This trade is already finished." });
    expect(writes(calls)).toEqual([]);
    expect(stored).toEqual([]);
  });

  test("a skipped trade is refused", async () => {
    const { database, bucket } = scriptedDb({ task: taskRow({ state: "skipped" }) });
    const response = await crewApp(database, bucket).start(1, { photos: [PHOTO] });
    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([409, "trade_skipped"]);
  });

  test("a task of another brand is not found, and the brand is a bound value", async () => {
    const { database, bucket, calls } = scriptedDb({ brand: "Dream Crafter", task: null });
    const response = await crewApp(database, bucket).start(1, { photos: [PHOTO] });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "task_not_found" });
    const lookup = calls.find((call) => call.sql.includes("WHERE t.id = ?"));
    expect(lookup?.sql).toContain("lower(trim(p.brand)) = lower(trim(?))");
    expect(lookup?.sql).not.toContain("Dream Crafter");
    expect(lookup?.args).toEqual([1, "Dream Crafter"]);
    expect(writes(calls)).toEqual([]);
  });

  test("an id that is not a number is not found", async () => {
    const { database, bucket } = scriptedDb({});
    expect((await crewApp(database, bucket).start("abc", { photos: [PHOTO] })).status).toBe(404);
  });
});

describe("finish a trade", () => {
  const started = taskRow({ state: "in_progress", actual_start: "2026-11-14" });
  const lines = [{ id: "0b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a10", qty: "3" }, { id: "1b6f3c1e-8f0e-4b43-9d0e-2a1c5d7e9a11", qty: "1.5" }];

  test("fills every unfinished line to its full qty, closes the open tasks and writes the after photos last", async () => {
    const { database, bucket, calls } = scriptedDb({ task: started, siblings: [started, taskRow({ id: 2, state: "open" })], lines });
    const response = await crewApp(database, bucket).finish(1, { photos: [PHOTO] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, linesCompleted: 2, closedTaskIds: [1, 2], waitingForReceipt: false });
    const fill = calls.find((call) => call.sql.includes("INSERT INTO project_line_progress"));
    expect(fill?.args.slice(0, 4)).toEqual([13, 1, null, 42]);
    expect(JSON.parse(String(fill?.args[4]))).toEqual([{ id: lines[0].id, qty: "3" }, { id: lines[1].id, qty: "1.5" }]);
    expect(calls.filter((call) => call.sql.includes("SET state = 'done'")).map((call) => call.args.at(-1))).toEqual([1, 2]);
    const rowsIndex = calls.findIndex((call) => call.sql.includes("beta_media") && call.sql.includes("jsonb_to_recordset"));
    expect(rowsIndex).toBeGreaterThan(calls.findIndex((call) => call.sql.includes("SET state = 'done'")));
    expect(firstMeta(calls[rowsIndex])).toMatchObject({ stage: "finish" });
    expect(calls.some((call) => call.args[1] === "task_done")).toBe(true);
  });

  test("runs the line fill and the task closes in one batch when the database has one", async () => {
    const { database, bucket, calls } = scriptedDb({ task: started, lines });
    const batches: number[] = [];
    const batching = { prepare: database.prepare, batch: async (statements: unknown[]) => { batches.push(statements.length); return []; } };
    const response = await crewApp(batching, bucket).finish(1, { photos: [PHOTO] });
    expect(response.status).toBe(200);
    expect(batches).toEqual([2]);
    expect(calls.some((call) => call.sql.includes("INSERT INTO project_line_progress"))).toBe(false);
  });

  test("a task fulfilled by a PO with PO lines waits for receipt and is not closed", async () => {
    const poTask = taskRow({ id: 5, state: "in_progress", actual_start: "2026-11-14", fulfilment_kind: "po" });
    const { database, bucket, calls } = scriptedDb({ task: poTask, siblings: [poTask], lines, poLinkedTaskIds: [5] });
    const response = await crewApp(database, bucket).finish(5, { photos: [PHOTO] });
    expect(await response.json()).toEqual({ ok: true, linesCompleted: 2, closedTaskIds: [], waitingForReceipt: true });
    expect(calls.some((call) => call.sql.includes("SET state = 'done'"))).toBe(false);
    expect(mediaRows(calls)).toHaveLength(1);
  });

  test("before the trade is started it is refused and nothing is written", async () => {
    const { database, bucket, calls, stored } = scriptedDb({ lines });
    const response = await crewApp(database, bucket).finish(1, { photos: [PHOTO] });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "not_started", message: "Start this trade first." });
    expect(writes(calls)).toEqual([]);
    expect(stored).toEqual([]);
  });

  test("a done trade, a missing photo and another brand's task are refused", async () => {
    const done = scriptedDb({ siblings: [taskRow({ state: "done" })] });
    expect(((await (await crewApp(done.database, done.bucket).finish(1, { photos: [PHOTO] })).json()) as { error: string }).error).toBe("trade_done");
    const noPhoto = scriptedDb({ task: started });
    expect((await crewApp(noPhoto.database, noPhoto.bucket).finish(1, {})).status).toBe(400);
    const other = scriptedDb({ task: null });
    expect((await crewApp(other.database, other.bucket).finish(1, { photos: [PHOTO] })).status).toBe(404);
    expect(writes(other.calls)).toEqual([]);
  });

  test("Built-in finishes through the carpentry task and reads the Built-in lines", async () => {
    const carpentry = taskRow({ id: 8, trade_code: "CAT:CARPENTRY", category_code: "CARPENTRY", state: "in_progress", actual_start: "2026-11-14" });
    const { database, bucket, calls } = scriptedDb({ task: carpentry, lines });
    expect((await crewApp(database, bucket).finish(8, { photos: [PHOTO] })).status).toBe(200);
    const siblingQuery = calls.find((call) => call.sql.includes("WHERE t.project_id = ?"));
    expect(siblingQuery?.sql).toContain("t.category_code = ?");
    expect(siblingQuery?.args.at(-1)).toBe("CARPENTRY");
    expect(calls.find((call) => call.sql.includes("coalesce(lp.done_qty, 0) < i.qty"))?.args).toEqual([13, "BUILTIN"]);
  });
});
