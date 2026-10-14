import { describe, expect, it } from "vitest";
import type { FlowStepKey } from "../../../vendor/shared/renovation-stages";
import { activeSteps, listFlags, projectHref, stepCounts, toggleStep } from "./renovationListModel";
import { filterRenoItems, itemLabel, itemsByDate, type RenoCalendarItem } from "./renovationCalendarItems";

const step = (key: FlowStepKey, label: string = key) => ({ key, label, index: 0, count: 6, manual: false });
const today = "2026-10-15";

describe("renovation Project List model (owner, 15 Oct 2026)", () => {
  it("uses the company's active steps in order, the six defaults until they load", () => {
    expect(activeSteps(null).map((s) => s.label)).toEqual(["Design", "Signed", "Ordering", "Renovation", "Handover", "Closed"]);
    expect(activeSteps([
      { step_key: "signed", label: "Contract signed", sort_order: 2, active: true },
      { step_key: "design", label: "Design", sort_order: 1, active: true },
      { step_key: "ordering", label: "Ordering", sort_order: 3, active: false },
    ]).map((s) => s.label)).toEqual(["Design", "Contract signed"]);
  });

  it("a step on a card opens that step's section of the project", () => {
    expect(projectHref(4)).toBe("/projects/4");
    expect(projectHref(4, "design")).toBe("/projects/4#reno-design");
    expect(projectHref(4, "signed")).toBe("/projects/4#reno-contract");
    expect(projectHref(4, "ordering")).toBe("/projects/4#reno-procurement");
    expect(projectHref(4, "renovation")).toBe("/projects/4#reno-unit-key");
    expect(projectHref(4, "handover")).toBe("/projects/4#reno-unit-key");
    expect(projectHref(4, "closed")).toBe("/projects/4");
  });

  it("counts projects per step and toggles a step tile", () => {
    const c = stepCounts([{ step: step("design") }, { step: step("design") }, { step: step("closed") }]);
    expect(c).toEqual({ design: 2, signed: 0, ordering: 0, renovation: 0, handover: 0, closed: 1 });
    expect(toggleStep(["design"], "signed")).toEqual(["design", "signed"]);
    expect(toggleStep(["design", "signed"], "design")).toEqual(["signed"]);
  });

  it("late: a passed planned handover or an overdue flag; never on a closed or handed-over project", () => {
    const base = { step: step("renovation", "Renovation"), plannedHandoverDate: "2026-10-10", handoverDate: null, redFlags: [] };
    expect(listFlags(base, today).late).toEqual(["Planned handover date has passed"]);
    expect(listFlags({ ...base, plannedHandoverDate: "2026-12-01", redFlags: [{ code: "task_overdue", text: "2 tasks past planned dates" }] }, today))
      .toEqual({ late: ["2 tasks past planned dates"], atRisk: [] });
    expect(listFlags({ ...base, step: step("closed") }, today)).toEqual({ late: [], atRisk: [] });
    expect(listFlags({ ...base, handoverDate: "2026-10-09" }, today)).toEqual({ late: [], atRisk: [] });
  });

  it("at risk: handover within 14 days while the works are not at Handover yet", () => {
    const base = { step: step("ordering", "Ordering"), plannedHandoverDate: "2026-10-25", handoverDate: null, redFlags: [] };
    expect(listFlags(base, today).atRisk).toEqual(["Handover in 10 days, still at Ordering"]);
    expect(listFlags({ ...base, plannedHandoverDate: "2026-10-16" }, today).atRisk).toEqual(["Handover tomorrow, still at Ordering"]);
    expect(listFlags({ ...base, plannedHandoverDate: "2026-11-30" }, today).atRisk).toEqual([]);
    expect(listFlags({ ...base, step: step("handover") }, today).atRisk).toEqual([]);
    expect(listFlags({ ...base, plannedHandoverDate: null }, today)).toEqual({ late: [], atRisk: [] });
  });
});

const item = (o: Partial<RenoCalendarItem>): RenoCalendarItem => ({
  key: "k", projectId: 1, projectName: "Skyline Residence A-1", short: "Skyline A-1", date: "2026-10-13", kind: "task",
  what: "Plumbing work", done: false, brand: null, status: "confirmed", organizer: null, ...o,
});

describe("renovation Week view items", () => {
  it("label is '<short name> · <what>'", () => {
    expect(itemLabel(item({}))).toBe("Skyline A-1 · Plumbing work");
  });
  it("the toolbar filters apply, search over project and item", () => {
    const list = [item({ key: "a" }), item({ key: "b", what: "Onsite", kind: "onsite", status: "pending" })];
    expect(filterRenoItems(list, { brand: "", status: "", organizer: "", q: "" })).toHaveLength(2);
    expect(filterRenoItems(list, { brand: "", status: "pending", organizer: "", q: "" }).map((i) => i.key)).toEqual(["b"]);
    expect(filterRenoItems(list, { brand: "", status: "", organizer: "", q: "plumb" }).map((i) => i.key)).toEqual(["a"]);
    expect(filterRenoItems(list, { brand: "X", status: "", organizer: "", q: "" })).toEqual([]);
  });
  it("groups by day", () => {
    const g = itemsByDate([item({ key: "a" }), item({ key: "b", date: "2026-10-14" }), item({ key: "c" })]);
    expect(g.get("2026-10-13")?.map((i) => i.key)).toEqual(["a", "c"]);
    expect(g.get("2026-10-14")?.map((i) => i.key)).toEqual(["b"]);
  });
});
