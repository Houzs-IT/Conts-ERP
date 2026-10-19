import { describe, expect, test } from "vitest";
import { listScopeQuery, renovationListScope, type ListScopeRow } from "../src/services/renovation/listScope";
import { buildCalendarItems, daysWithin, shortProjectName, type ItemSources } from "../src/services/renovation/calendarItems";

const rows: ListScopeRow[] = [
  { id: 1, step: "design", createdAt: "2026-10-01T03:00:00Z", plannedHandover: "2026-11-30", handedOverAt: null },
  { id: 2, step: "ordering", createdAt: "2026-08-01T03:00:00Z", plannedHandover: "2026-09-15", handedOverAt: null },
  { id: 3, step: "closed", createdAt: "2026-06-01T03:00:00Z", plannedHandover: null, handedOverAt: "2026-07-01T03:00:00Z" },
];

describe("renovation Project List filters (owner, 15 Oct 2026)", () => {
  test("nothing renovation-specific asked: no scope at all", () => {
    expect(listScopeQuery({})).toBeNull();
    expect(listScopeQuery({ reno: "1" })).toBeNull();
    expect(listScopeQuery({ reno_step: "design" })).toBeNull();
  });
  test("unknown step keys and bad dates are dropped", () => {
    expect(listScopeQuery({ reno: "1", reno_step: "design,bogus", from: "2026-1-1" })).toEqual({ steps: ["design"], hideClosed: false, from: "", to: "" });
  });
  test("a picked step keeps only its projects, an empty step keeps none", () => {
    expect(renovationListScope(rows, { steps: ["design", "ordering"], hideClosed: false, from: "", to: "" }).onlyIds).toEqual([1, 2]);
    expect(renovationListScope(rows, { steps: ["handover"], hideClosed: false, from: "", to: "" }).onlyIds).toEqual([]);
  });
  test("Hide completed drops the Closed projects", () => {
    const s = renovationListScope(rows, { steps: [], hideClosed: true, from: "", to: "" });
    expect(s.exceptIds).toEqual([3]);
    expect(s.onlyIds).toBeUndefined();
  });
  test("the date range matches the calendar bar, created to planned handover", () => {
    expect(renovationListScope(rows, { steps: [], hideClosed: false, from: "2026-10-01", to: "2026-10-31" }).rangeIds).toEqual([1]);
    expect(renovationListScope(rows, { steps: [], hideClosed: false, from: "2026-09-01", to: "" }).rangeIds).toEqual([1, 2]);
    expect(renovationListScope(rows, { steps: [], hideClosed: false, from: "", to: "2026-06-30" }).rangeIds).toEqual([3]);
  });
});

const P = { project_id: 7, name: "Skyline Residence A-12-3", building: "Skyline Residence", unit_no: "A-12-3", brand: null, status: null, organizer: null };
const empty: ItemSources = { onsite: [], design: [], procurement: [], tasks: [], handover: [] };

describe("renovation Week view items (owner, 15 Oct 2026)", () => {
  test("short name: first word of the building and the unit; the name when there is no unit", () => {
    expect(shortProjectName(P)).toBe("Skyline A-12-3");
    expect(shortProjectName({ ...P, building: null })).toBe("A-12-3");
    expect(shortProjectName({ ...P, unit_no: null })).toBe("Skyline Residence A-12-3");
    expect(shortProjectName({ ...P, building: "Eco Sky", unit_no: "15-06" })).toBe("Eco Sky 15-06");
  });
  test("a task sits on every day of its planned range inside the window", () => {
    expect(daysWithin("2026-10-10", "2026-10-14", "2026-10-12", "2026-10-18")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(daysWithin(null, "2026-10-13", "2026-10-12", "2026-10-18")).toEqual(["2026-10-13"]);
    expect(daysWithin("2026-10-20", "2026-10-22", "2026-10-12", "2026-10-18")).toEqual([]);
  });
  test("one card per dated item, sorted by first day then kind; a site task is one card over its range", () => {
    const items = buildCalendarItems({
      onsite: [{ ...P, id: 1, done_on: "2026-10-13" }],
      design: [{ ...P, id: 2, kind: "3d", version: 2, on_day: "2026-10-14" }, { ...P, id: 3, kind: "other", version: 1, on_day: "2026-10-14" }],
      procurement: [
        { ...P, group_code: "FURNITURE", sub_code: "", group_label: "Furniture", sub_label: null, po_date: "2026-10-12", delivery_date: "2026-10-25" },
        { ...P, group_code: "FURNITURE", sub_code: "SOFA", group_label: "Furniture", sub_label: "Sofa", po_date: null, delivery_date: "2026-10-16" },
      ],
      tasks: [{ ...P, id: 9, label: "Plumbing work", state: "open", planned_start: "2026-10-15", planned_end: "2026-10-16" }],
      handover: [{ ...P, planned_handover_date: "2026-10-16", handed_over_at: null }],
    }, "2026-10-12", "2026-10-18");
    expect(items.map((i) => `${i.date} ${i.kind} ${i.short} · ${i.what}`)).toEqual([
      "2026-10-12 po Skyline A-12-3 · PO · Furniture",
      "2026-10-13 onsite Skyline A-12-3 · Onsite",
      "2026-10-14 3d Skyline A-12-3 · 3D v2 submitted",
      "2026-10-15 task Skyline A-12-3 · Plumbing work",
      "2026-10-16 handover Skyline A-12-3 · Planned handover",
      "2026-10-16 delivery Skyline A-12-3 · Delivery · Furniture / Sofa",
    ]);
    expect(items.find((i) => i.kind === "task")).toMatchObject({ date: "2026-10-15", end: "2026-10-16", title: "PLUMBING WORK" });
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items.every((i) => i.projectId === 7)).toBe(true);
  });
  test("nothing dated in the window: no chips", () => {
    expect(buildCalendarItems(empty, "2026-10-12", "2026-10-18")).toEqual([]);
  });
});
