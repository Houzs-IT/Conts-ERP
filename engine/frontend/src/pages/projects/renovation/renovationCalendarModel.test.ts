/* The Notion-style renovation calendar's pure parts: windows, filters in the URL, departments, week lanes. */
import { describe, expect, it } from "vitest";
import { itemsByDate, type RenoCalendarItem } from "./renovationCalendarItems";
import {
  activeFilterCount,
  applyRenoFilters,
  itemDepartment,
  itemStatus,
  jumpTo,
  layoutWeek,
  parseRenoFilters,
  peopleOnItems,
  personDepartment,
  renoFilterPatch,
  renoWindow,
  spanLabel,
  stepWindow,
} from "./renovationCalendarModel";

const ying = { id: 1, name: "YING TZY", roles: ["designer"] };
const alex = { id: 2, name: "Alex", roles: ["sales"] };
const crew = { id: 4, name: "Ah Seng", roles: ["site_crew"] };

function item(over: Partial<RenoCalendarItem>): RenoCalendarItem {
  return {
    key: "k", projectId: 7, projectName: "JERNIH KAJANG B-28-09 MR EDDIE", projectCode: "RN-007", short: "Jernih B-28-09",
    date: "2026-10-13", end: "2026-10-13", kind: "task", title: "PLUMBING WORK", what: "Plumbing work", done: false,
    people: [], department: "renovation", supplier: null, brand: null, status: null, organizer: null, ...over,
  };
}

describe("window", () => {
  it("month: Sunday-first weeks covering the whole month, October 2026", () => {
    const w = renoWindow("month", "2026-10", "", "2026-10-16");
    expect(w.label).toBe("October 2026");
    expect(w.weeks).toHaveLength(5);
    expect(w.weeks[0]![0]).toBe("2026-09-27");
    expect(w.from).toBe("2026-09-27");
    expect(w.to).toBe("2026-10-31");
  });
  it("week: the Sunday-first week of the given day", () => {
    const w = renoWindow("week", "", "2026-10-16", "2026-10-16");
    expect(w.weeks[0]).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(w.label).toBe("11 – 17 Oct 2026");
    expect(renoWindow("week", "", "2026-09-29", "x").label).toBe("27 Sep – 3 Oct 2026");
  });
  it("bad URL values fall back to today", () => {
    expect(renoWindow("month", "2026-13", "", "2026-10-16").month).toBe("2026-10");
    expect(renoWindow("week", "", "nope", "2026-10-16").weekStart).toBe("2026-10-11");
  });
  it("prev / next / jump", () => {
    expect(stepWindow(renoWindow("month", "2026-01", "", "x"), -1).month).toBe("2025-12");
    expect(stepWindow(renoWindow("week", "", "2026-10-11", "x"), 1)).toEqual({ month: "2026-10", week: "2026-10-18" });
    expect(jumpTo("2026-12-25")).toEqual({ month: "2026-12", week: "2026-12-20" });
  });
});

describe("filters in the URL", () => {
  it("parse and write back, dropping unknown values", () => {
    const f = parseRenoFilters(new URLSearchParams("dept=design,bogus,sales&person=2,x,1&mine=1&q=jernih&state=done"));
    expect(f).toEqual({ depts: ["design", "sales"], people: [2, 1], mine: true, q: "jernih", state: "done" });
    expect(activeFilterCount(f)).toBe(5);
    expect(renoFilterPatch({ depts: [], mine: false, state: "" })).toEqual({ dept: "", mine: "", state: "" });
    expect(parseRenoFilters(new URLSearchParams("state=maybe")).state).toBe("");
  });
  it("department, person, my tasks, project search and status", () => {
    const list = [
      item({ key: "a", department: "design", people: [ying], kind: "2d", title: "2D AMENDMENT" }),
      item({ key: "b", department: "sales", people: [alex], projectName: "SKYLINE A-12", short: "Skyline A-12", done: true }),
      item({ key: "c", department: "site_crew", people: [crew, ying] }),
    ];
    const keys = (f: string, me: number[] = []) => applyRenoFilters(list, parseRenoFilters(new URLSearchParams(f)), me).map((i) => i.key);
    expect(keys("")).toEqual(["a", "b", "c"]);
    expect(keys("dept=design,sales")).toEqual(["a", "b"]);
    expect(keys("person=1")).toEqual(["a", "c"]);
    expect(keys("mine=1", [4])).toEqual(["c"]);
    expect(keys("mine=1")).toEqual([]);
    expect(keys("q=skyline")).toEqual(["b"]);
    expect(keys("q=amendment")).toEqual(["a"]);
    expect(keys("state=done")).toEqual(["b"]);
    expect(keys("state=open&dept=site_crew")).toEqual(["c"]);
  });
  it("the person picker lists everyone on the items with counts", () => {
    const opts = peopleOnItems([item({ key: "a", people: [ying] }), item({ key: "c", people: [crew, ying] })]);
    expect(opts.map((o) => [o.person.name, o.count, o.department])).toEqual([["Ah Seng", 1, "site_crew"], ["YING TZY", 2, "design"]]);
  });
});

describe("departments and status", () => {
  it("a person's department follows their roles", () => {
    expect(personDepartment({ roles: ["boss", "designer"] })).toBe("design");
    expect(personDepartment({ roles: ["admin"] })).toBe("management");
    expect(personDepartment({ roles: ["reno_pic"] })).toBe("renovation");
    expect(personDepartment({ roles: [] })).toBeNull();
  });
  it("an item from an older server takes its kind's department", () => {
    expect(itemDepartment({ kind: "onsite" })).toBe("design");
    expect(itemDepartment({ kind: "delivery" })).toBe("renovation");
    expect(itemDepartment({ kind: "onsite", department: "sales" })).toBe("sales");
  });
  it("done, overdue (tasks and amendments only), open", () => {
    expect(itemStatus(item({ done: true }), "2026-10-20")).toBe("done");
    expect(itemStatus(item({ end: "2026-10-14" }), "2026-10-20")).toBe("overdue");
    expect(itemStatus(item({ kind: "po", date: "2026-10-01", end: "2026-10-01" }), "2026-10-20")).toBe("open");
    expect(itemStatus(item({}), "2026-10-13")).toBe("open");
  });
  it("span labels", () => {
    expect(spanLabel({ date: "2026-10-08", end: "2026-10-08" })).toBe("8 Oct");
    expect(spanLabel({ date: "2026-10-08", end: "2026-10-12" })).toBe("8 – 12 Oct");
    expect(spanLabel({ date: "2026-09-28", end: "2026-10-02" })).toBe("28 Sep – 2 Oct");
  });
});

describe("week lanes", () => {
  const week = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
  it("a multi-day item is one segment across its days, clipped at the week's edges", () => {
    const l = layoutWeek([item({ key: "long", date: "2026-10-08", end: "2026-10-13" }), item({ key: "one", date: "2026-10-12", end: "2026-10-12" })], week);
    const long = l.segments.find((s) => s.item.key === "long")!;
    expect(long).toMatchObject({ startCol: 0, endCol: 2, clipLeft: true, clipRight: false, lane: 0 });
    expect(l.segments.find((s) => s.item.key === "one")!.lane).toBe(1);
    expect(l.lanes).toBe(2);
  });
  it("items that do not overlap share a lane; past the cap they are counted per day", () => {
    const list = [
      item({ key: "a", date: "2026-10-12" }), item({ key: "b", date: "2026-10-14", end: "2026-10-14" }),
      item({ key: "c", date: "2026-10-12", end: "2026-10-12" }), item({ key: "d", date: "2026-10-12", end: "2026-10-12" }),
      item({ key: "e", date: "2026-10-12", end: "2026-10-13" }),
    ];
    const l = layoutWeek(list, week, 3);
    expect(l.segments.find((s) => s.item.key === "b")!.lane).toBe(0);
    expect(l.lanes).toBe(3);
    expect(l.segments).toHaveLength(4);
    expect(l.hidden).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
  it("itemsByDate puts a span on every day it covers", () => {
    const g = itemsByDate([item({ key: "s", date: "2026-10-12", end: "2026-10-14" }), item({ key: "old", date: "2026-10-12", end: undefined })]);
    expect([...g.keys()]).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(g.get("2026-10-12")!.map((i) => i.key)).toEqual(["s", "old"]);
  });
});
