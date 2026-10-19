import { describe, expect, test } from "vitest";
import { activityText, cleanTimelineNote, datedAt, flowLogText, isoOf, readProjectTimeline, sortTimeline, type TimelineEntry } from "../src/services/renovation/timeline";
import type { Db, DbStmt } from "../src/services/renovation/load";

describe("timeline notes: input", () => {
  test("a note needs a known type and some text, up to 2000 characters", () => {
    expect(cleanTimelineNote({ type: "Design", note: "  Customer wants oak  " })).toEqual({ ok: true, value: { type: "design", note: "Customer wants oak" } });
    expect(cleanTimelineNote({ type: "system", note: "x" })).toMatchObject({ ok: false, error: "type_invalid" });
    expect(cleanTimelineNote({ note: "x" })).toMatchObject({ ok: false, error: "type_invalid" });
    expect(cleanTimelineNote({ type: "site", note: "   " })).toMatchObject({ ok: false, error: "note_required" });
    expect(cleanTimelineNote({ type: "site", note: "a".repeat(2001) })).toMatchObject({ ok: false, error: "note_too_long" });
    for (const t of ["customer", "design", "supplier", "site", "sales"]) expect(cleanTimelineNote({ type: t, note: "ok" }).ok).toBe(true);
  });
});

describe("timeline: times", () => {
  test("text timestamps without a zone are UTC", () => {
    expect(isoOf("2026-10-15 03:04:05")).toBe("2026-10-15T03:04:05.000Z");
    expect(isoOf("2026-10-15T03:04:05Z")).toBe("2026-10-15T03:04:05.000Z");
    expect(isoOf("2026-10-15T11:04:05+08:00")).toBe("2026-10-15T03:04:05.000Z");
    expect(isoOf(null)).toBeNull();
    expect(isoOf("nonsense")).toBeNull();
  });
  test("a dated record keeps its typing time on the same Malaysian day, else shows the date only", () => {
    // 15 Oct 01:00 UTC is 15 Oct 09:00 in Malaysia
    expect(datedAt("2026-10-15", "2026-10-15T01:00:00Z")).toEqual({ at: "2026-10-15T01:00:00.000Z", dateOnly: false });
    // typed on 15 Oct about a key that moved on 12 Oct
    expect(datedAt("2026-10-12", "2026-10-15T01:00:00Z")).toEqual({ at: "2026-10-12T04:00:00.000Z", dateOnly: true });
    // 14 Oct 20:00 UTC is already 15 Oct in Malaysia
    expect(datedAt("2026-10-15", "2026-10-14T20:00:00Z")).toEqual({ at: "2026-10-14T20:00:00.000Z", dateOnly: false });
    expect(datedAt(null, "2026-10-15T01:00:00Z")).toEqual({ at: "2026-10-15T01:00:00.000Z", dateOnly: false });
    expect(datedAt(null, null)).toBeNull();
  });
  test("newest first", () => {
    const e = (id: string, at: string): TimelineEntry => ({ id, at, dateOnly: false, category: "system", title: id, body: null, by: null });
    expect(sortTimeline([e("a", "2026-10-01T00:00:00Z"), e("b", "2026-10-03T00:00:00Z"), e("c", "2026-10-02T00:00:00Z")]).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("timeline: system entries in words", () => {
  test("project activity", () => {
    expect(activityText({ action: "created", to_value: "RN-2610-001" })).toEqual({ title: "Project created", body: "RN-2610-001" });
    // the importer's from_value is its source, not a changed value
    expect(activityText({ action: "notion_import", from_value: "notion", note: "Imported from Notion" })).toEqual({ title: "Notion import", body: "Imported from Notion" });
    expect(activityText({ action: "sla_changed", from_value: "14 days", to_value: "21 days", note: "SLA for Design" })).toEqual({ title: "SLA for Design changed", body: "14 days to 21 days" });
    expect(activityText({ action: "so_linked", to_value: "SO-1" }).title).toBe("Sales order SO-1 linked");
    expect(activityText({ action: "so_unlinked", from_value: "SO-1" }).title).toBe("Sales order SO-1 unlinked");
    expect(activityText({ action: "customer_info_saved", note: "Customer and property information saved" })).toEqual({ title: "Customer information edited", body: "Customer and property information saved" });
    expect(activityText({ action: "reno_pic_changed", from_value: "Ali", to_value: "Bob" })).toEqual({ title: "Project PIC changed", body: "Ali to Bob" });
    expect(activityText({ action: "handover_signed", to_value: "Ms Lim" })).toEqual({ title: "Handover signed", body: "Signed by Ms Lim" });
    expect(activityText({ action: "stage_started", from_value: "hacking", to_value: "in_progress" })).toEqual({ title: "Stage started", body: "hacking to in_progress" });
  });
  test("step history and hold flag use the company's step labels", () => {
    const labels = { signed: "Contract signed" };
    expect(flowLogText({ kind: "manual_step", from_value: "design", to_value: "signed", reason: "deposit in" }, labels))
      .toEqual({ title: "Step changed to Contract signed", body: "From Design · deposit in" });
    expect(flowLogText({ kind: "hold_set", to_value: "on_hold", reason: "customer away" }, {})).toEqual({ title: "Flag set: ON HOLD", body: "customer away" });
    expect(flowLogText({ kind: "hold_cleared", from_value: "in_defect" }, {})).toEqual({ title: "Flag cleared: IN DEFECT", body: null });
  });
});

/* A fake Db answering each query by a fragment of its SQL. */
function fakeDb(answers: Array<[RegExp, Array<Record<string, unknown>>]>): Db {
  const stmt = (sql: string): DbStmt => {
    const rows = () => answers.find(([re]) => re.test(sql))?.[1] ?? [];
    const s: DbStmt = {
      bind: () => s,
      all: async <T>() => ({ results: rows() as T[] }),
      first: async <T>() => (rows()[0] ?? null) as T | null,
      run: async () => ({}),
    };
    return s;
  };
  return { prepare: stmt };
}

describe("timeline: one project's entries", () => {
  const db = fakeDb([
    [/FROM projects WHERE id/, [{ created_at: "2026-10-01T02:00:00Z", closed_at: null, handed_over_at: null }]],
    [/FROM project_activity/, [
      { id: 5, action: "created", to_value: "RN-2610-001", created_at: "2026-10-01T02:00:00Z", user_name: "Alex" },
      { id: 6, action: "so_linked", to_value: "SO-9", created_at: "2026-10-05T02:00:00Z", user_name: "Alex" },
    ]],
    [/FROM project_flow_log/, [{ id: 1, kind: "manual_step", from_value: "design", to_value: "signed", reason: null, at: "2026-10-06T02:00:00Z", by_name: "Boss" }]],
    [/FROM project_flow_steps/, []],
    [/FROM project_key_moves/, [{ id: 2, moved_on: "2026-10-03", created_at: "2026-10-09T02:00:00Z", from_name: "Office", to_name: "Ah Seng", note: null, by_name: "Alex" }]],
    [/FROM project_design_records/, [{ id: 3, done_on: "2026-10-02", created_at: "2026-10-02T03:00:00Z", note: "measured", by_name: "Dee", people: "Dee" }]],
    [/FROM project_design_files/, [{ id: 4, kind: "3d", version: 1, file_name: "x", is_link: true, submitted_on: "2026-10-04", uploaded_at: "2026-10-04T05:00:00Z", note: null, by_name: "Dee", people: "Dee, Eve" }]],
    [/FROM project_design_notes/, [{ id: 7, kind: "2d", noted_on: "2026-10-07", created_at: "2026-10-07T06:00:00Z", note: "move the TV wall", requested_by: "Ms Lim", by_name: "Dee" }]],
    [/FROM project_timeline_notes/, [{ id: 8, note_type: "customer", note: "Prefers weekend calls", created_at: "2026-10-08T01:00:00Z", by_name: "Alex" }]],
    [/scm\.purchase_orders po/, [{ kind: "po", id: "u1", no: "PO-1", created_at: "2026-10-10T01:00:00Z", detail: "Wiring Sdn Bhd · WORKS / ELECTRICAL", by_name: "Test" }]],
  ]);

  test("merges every source newest first, typed notes keep their type", async () => {
    const list = await readProjectTimeline(db, 1, 1, { notesReady: true, docsReady: true });
    expect(list.map((e) => e.title ?? `[${e.category}] ${e.body}`)).toEqual([
      "Purchase order PO-1 created",
      "[customer] Prefers weekend calls",
      "2D amendment requested",
      "Step changed to Signed",
      "Sales order SO-9 linked",
      "3D v1 submitted (link)",
      "Key passed: Office to Ah Seng",
      "Design onsite visit",
      "Project created",
    ]);
    expect(list.find((e) => e.id === "key:2")).toMatchObject({ dateOnly: true, at: "2026-10-03T04:00:00.000Z", by: "Alex" });
    expect(list.find((e) => e.id === "note:8")).toMatchObject({ category: "customer", noteId: 8, by: "Alex" });
    expect(list.filter((e) => e.category === "system")).toHaveLength(8);
  });

  test("before migration 0118 / 0116: no notes, no documents, a project without a created row still shows one", async () => {
    const bare = fakeDb([
      [/FROM projects WHERE id/, [{ created_at: "2026-10-01 02:00:00", closed_at: "2026-10-20T02:00:00Z", handed_over_at: "2026-10-18T02:00:00Z", end_date: "2026-10-20" }]],
      [/FROM project_timeline_notes/, [{ id: 99, note_type: "site", note: "should not show", created_at: "2026-10-08T01:00:00Z" }]],
      [/scm\.purchase_orders po/, [{ kind: "po", id: "u1", no: "PO-1", created_at: "2026-10-10T01:00:00Z" }]],
    ]);
    const list = await readProjectTimeline(bare, 1, 1, { notesReady: false, docsReady: false });
    expect(list.map((e) => e.title)).toEqual(["Project completed", "Handed over", "Project created"]);
    expect(list[2]!.at).toBe("2026-10-01T02:00:00.000Z");
    expect(list[0]).toMatchObject({ id: "project:closed", dateOnly: false, at: "2026-10-20T02:00:00.000Z" });
  });

  test("a project closed by its data shows Project completed on its end date", async () => {
    const closed = fakeDb([[/FROM projects WHERE id/, [{ created_at: "2026-10-01T02:00:00Z", closed_at: null, handed_over_at: null, end_date: "2026-10-25" }]]]);
    const list = await readProjectTimeline(closed, 1, 1, { notesReady: true, docsReady: true });
    expect(list[0]).toMatchObject({ title: "Project completed", dateOnly: true, at: "2026-10-25T04:00:00.000Z" });
  });
});
