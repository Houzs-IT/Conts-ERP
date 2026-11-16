import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import siteForward from "../src/conts/site-forward-routes";
import type { Staff } from "../src/conts/staff-identity";

const RENOVATOR: Staff = { userId: "u-reno", name: "Ah Seng", email: "seng@example.test", departmentId: null, side: null, role: "renovator", field: false };

interface Script {
  missingRenovators?: boolean;
  tasks?: Array<Record<string, unknown>>;
  remaining?: number;
  brand?: string | null;
  personId?: number | null;
  line?: Record<string, unknown> | null;
}

interface Call {
  sql: string;
  args: unknown[];
}

function scriptedDb(script: Script) {
  const calls: Call[] = [];
  const answer = (sql: string): unknown => {
    if (sql.includes("public.conts_renovators") && script.missingRenovators) throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    if (sql.includes("count(*)::int AS remaining")) return { remaining: script.remaining ?? 0 };
    if (sql.includes("count(*)::int AS photo_count")) return { photo_count: 2 };
    if (sql.includes("public.conts_renovators")) return script.brand === undefined ? null : { brand_name: script.brand };
    if (sql.includes("FROM project_people")) return script.personId === undefined ? null : { id: script.personId };
    if (sql.includes("i.id::text = ?")) return script.line ?? null;
    return null;
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => {
      calls.push({ sql, args });
      return answer(sql);
    },
    all: async () => {
      calls.push({ sql, args });
      return { results: sql.includes("FROM project_trade_tasks t") ? script.tasks ?? [] : [] };
    },
    run: async () => {
      calls.push({ sql, args });
      return {};
    },
  });
  const stored: Array<{ key: string; contentType: string; size: number }> = [];
  const bucket = { put: async (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => { stored.push({ key, contentType: options.httpMetadata.contentType, size: value.byteLength }); } };
  return { calls, stored, bucket, database: { prepare: (sql: string) => statement(sql) } };
}

const PHOTO = { name: "IMG_1.jpg", mime: "image/jpeg", dataBase64: btoa("pretend-jpeg-bytes") };

const mediaInserts = (calls: Call[]): Call[] => calls.filter((call) => call.sql.includes("jsonb_to_recordset"));

const closedTask = { id: 1, trade_code: "ELECTRICAL", fulfilment_kind: "internal", state: "done" };

function crewApp(database: unknown, staff: Staff = RENOVATOR, bucket: unknown = { put: async () => undefined }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("staff" as never, staff as never);
    c.set("companyId" as never, 1 as never);
    await next();
  });
  app.route("/api/site-forward", siteForward);
  return {
    jobs: () => app.request("/api/site-forward/jobs", { method: "GET" }, { DB: database, POD_BUCKET: bucket }),
    save: (body: unknown) => app.request("/api/site-forward/lines/line-1/progress", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, { DB: database, POD_BUCKET: bucket }),
  };
}

const worksLine = { id: "line-1", project_id: 13, company_id: 1, cat_code: "WORKS", sub_code: "ELECTRICAL", qty: "3", done_qty: null };

describe("renovator crew routes", () => {
  test("someone who is not a renovator is refused", async () => {
    const { database } = scriptedDb({ brand: "The Conts" });
    const crew = crewApp(database, { ...RENOVATOR, role: "housekeeper" });
    const jobs = await crew.jobs();
    expect(jobs.status).toBe(403);
    expect(await jobs.json()).toMatchObject({ error: "not_renovator" });
    expect((await crew.save({ doneQty: 1, photos: [PHOTO] })).status).toBe(403);
  });

  test("a renovator with no brand gets no_brand on both routes", async () => {
    const crew = crewApp(scriptedDb({ brand: null }).database);
    const jobs = await crew.jobs();
    expect(jobs.status).toBe(409);
    expect(await jobs.json()).toMatchObject({ error: "no_brand" });
    const saved = await crew.save({ doneQty: 1, photos: [PHOTO] });
    expect(saved.status).toBe(409);
    expect(await saved.json()).toMatchObject({ error: "no_brand" });
  });

  test("the jobs list asks only for the renovator's brand, as a bound value", async () => {
    const { database, calls } = scriptedDb({ brand: " The Conts " });
    const jobs = await crewApp(database).jobs();
    expect(jobs.status).toBe(200);
    expect(await jobs.json()).toEqual({ brand: "The Conts", areTicksReady: true, projects: [] });
    const boardCalls = calls.filter((call) => call.sql.includes("p.archived_at IS NULL"));
    expect(boardCalls.length).toBeGreaterThanOrEqual(4);
    for (const call of boardCalls) {
      expect(call.sql).toContain("lower(trim(p.brand)) = lower(trim(?))");
      expect(call.sql).not.toContain("The Conts");
      expect(call.args).toEqual(["The Conts"]);
    }
  });

  test("a line of another brand is not found", async () => {
    const { database, calls } = scriptedDb({ brand: "Dream Crafter", line: null });
    const saved = await crewApp(database).save({ doneQty: 1, photos: [PHOTO] });
    expect(saved.status).toBe(404);
    expect(await saved.json()).toMatchObject({ error: "line_not_found" });
    const lookup = calls.find((call) => call.sql.includes("i.id::text = ?"));
    expect(lookup?.sql).toContain("lower(trim(p.brand)) = lower(trim(?))");
    expect(lookup?.args).toEqual(["line-1", "Dream Crafter"]);
    expect(calls.some((call) => call.sql.includes("INSERT INTO project_line_progress"))).toBe(false);
  });

  test("a save records the count, the person, and no office user", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", personId: 42, line: worksLine });
    const saved = await crewApp(database).save({ doneQty: 2, photos: [PHOTO] });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, previousDoneQty: 0, doneQty: 2, completedTaskIds: [], photoCount: 2 });
    const write = calls.find((call) => call.sql.includes("INSERT INTO project_line_progress"));
    expect(write?.args).toEqual(["line-1", 13, 1, 2, null, 42]);
  });

  test("a save by someone with no person record leaves the person blank", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", line: worksLine });
    expect((await crewApp(database).save({ doneQty: 1, photos: [PHOTO] })).status).toBe(200);
    expect(calls.find((call) => call.sql.includes("INSERT INTO project_line_progress"))?.args).toEqual(["line-1", 13, 1, 1, null, null]);
  });

  test("a count above the line's qty is refused", async () => {
    const { database } = scriptedDb({ brand: "The Conts", line: worksLine });
    const saved = await crewApp(database).save({ doneQty: 4, photos: [PHOTO] });
    expect(saved.status).toBe(400);
    expect(await saved.json()).toMatchObject({ error: "invalid_qty" });
  });

  test("no photo is refused before anything is written", async () => {
    const { database, calls, stored } = scriptedDb({ brand: "The Conts", line: worksLine });
    const response = await crewApp(database).save({ doneQty: 1, photos: [] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "photo_required", message: "Add at least one photo of the work." });
    expect((await crewApp(database).save({ doneQty: 1 })).status).toBe(400);
    expect(stored).toEqual([]);
    expect(calls.some((call) => call.sql.includes("INSERT"))).toBe(false);
  });

  test("a photo of the wrong type, a broken photo and an eleventh photo are refused", async () => {
    const { database } = scriptedDb({ brand: "The Conts", line: worksLine });
    const crew = crewApp(database);
    const wrongType = await crew.save({ doneQty: 1, photos: [{ ...PHOTO, mime: "application/pdf" }] });
    expect([wrongType.status, ((await wrongType.json()) as { error: string }).error]).toEqual([400, "photo_invalid"]);
    const broken = await crew.save({ doneQty: 1, photos: [{ ...PHOTO, dataBase64: "***" }] });
    expect([broken.status, ((await broken.json()) as { error: string }).error]).toEqual([400, "photo_invalid"]);
    const tooMany = await crew.save({ doneQty: 1, photos: Array.from({ length: 11 }, () => PHOTO) });
    expect([tooMany.status, ((await tooMany.json()) as { error: string }).error]).toEqual([400, "photo_invalid"]);
  });

  test("photos are stored under the project, then the rows are written after the count", async () => {
    const { database, calls, stored, bucket } = scriptedDb({ brand: "The Conts", personId: 42, line: worksLine });
    const saved = await crewApp(database, RENOVATOR, bucket).save({ doneQty: 2, photos: [PHOTO, { ...PHOTO, name: "IMG_2.png", mime: "image/png" }] });
    expect(saved.status).toBe(200);
    expect(stored.map((file) => [file.key.startsWith("renovation/13/proof-"), file.contentType])).toEqual([[true, "image/jpeg"], [true, "image/png"]]);
    const countIndex = calls.findIndex((call) => call.sql.includes("INSERT INTO project_line_progress"));
    const rowsIndex = calls.findIndex((call) => call.sql.includes("jsonb_to_recordset"));
    expect(countIndex).toBeGreaterThan(-1);
    expect(rowsIndex).toBeGreaterThan(countIndex);
    const rows = calls[rowsIndex];
    expect(rows.args.slice(0, 3)).toEqual([13, "line:line-1", 1]);
    const written = JSON.parse(String(rows.args[3])) as Array<{ key: string; meta: string }>;
    expect(written.map((row) => (JSON.parse(row.meta) as { by: string }).by)).toEqual(["Ah Seng", "Ah Seng"]);
  });

  test("a refused count writes no photo row", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", line: worksLine });
    expect((await crewApp(database).save({ doneQty: 9, photos: [PHOTO] })).status).toBe(400);
    expect(mediaInserts(calls)).toEqual([]);
    const closed = scriptedDb({ brand: "The Conts", line: { ...worksLine, done_qty: "3" }, tasks: [closedTask] });
    expect((await crewApp(closed.database).save({ doneQty: 1, photos: [PHOTO] })).status).toBe(409);
    expect(mediaInserts(closed.calls)).toEqual([]);
  });

  test("lowering a count on a closed trade answers trade_complete", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", line: { ...worksLine, done_qty: "3" }, tasks: [closedTask] });
    const response = await crewApp(database).save({ doneQty: 2, photos: [PHOTO] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "trade_complete" });
    expect(calls.some((call) => call.sql.includes("INSERT INTO project_line_progress"))).toBe(false);
  });

  test("a save to the full count leaves the trade open", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", line: worksLine, remaining: 0, tasks: [{ ...closedTask, id: 9, state: "in_progress" }] });
    const response = await crewApp(database).save({ doneQty: 3, photos: [PHOTO] });
    expect(await response.json()).toMatchObject({ completedTaskIds: [], photoCount: 2 });
    expect(calls.some((call) => call.sql.includes("state = 'done'") || call.args[1] === "task_done")).toBe(false);
  });

  test("the person is looked up in the line's own company", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts", personId: 5, line: { ...worksLine, company_id: 2 } });
    await crewApp(database).save({ doneQty: 1, photos: [PHOTO] });
    expect(calls.find((call) => call.sql.includes("FROM project_people"))?.args).toEqual([2, "u-reno"]);
  });

  test("a server without the renovators table says jobs are not switched on", async () => {
    const { database } = scriptedDb({ missingRenovators: true });
    const crew = crewApp(database);
    for (const response of [await crew.jobs(), await crew.save({ doneQty: 1, photos: [PHOTO] })]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "jobs_not_ready", message: "Jobs are not switched on yet on this server." });
    }
  });

  test("the jobs list reads every line's photos in one query", async () => {
    const { database, calls } = scriptedDb({ brand: "The Conts" });
    await crewApp(database).jobs();
    expect(calls.filter((call) => call.sql.includes("line:%") && call.sql.includes("ranked"))).toHaveLength(1);
  });
});
