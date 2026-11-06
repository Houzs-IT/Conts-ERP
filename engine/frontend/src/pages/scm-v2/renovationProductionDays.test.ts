import { describe, expect, it } from "vitest";
import { dayStrip, initialDay, materialCalculation, materialTally, mytDate, mytTime, pageStart } from "./renovationProductionDays";
import type { MaterialRow, MaterialStatus } from "../../vendor/scm/lib/production-order-queries";

const plan = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10"];
const photo = (at: string, by: string | null = "Ali") => ({ id: at, at, by });

describe("dayStrip", () => {
  it("numbers the plan days and groups photos by the Malaysian day", () => {
    const days = dayStrip(plan, [photo("2026-11-02T17:00:00Z"), photo("2026-11-03T02:00:00Z")], "2026-11-06", []);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ label: "Day 1", date: "2026-11-03", future: false });
    expect(days[0]!.photos).toHaveLength(2);
    expect(days[3]).toMatchObject({ label: "Day 4", future: false });
    expect(days[4]).toMatchObject({ label: "Day 5", future: true });
  });
  it("carries on past the plan, skipping Sundays and holidays", () => {
    const days = dayStrip(plan, [], "2026-11-16", ["2026-11-12"]);
    expect(days.map((d) => d.date).slice(7)).toEqual(["2026-11-11", "2026-11-13", "2026-11-14", "2026-11-16"]);
    expect(days.at(-1)!.label).toBe("Day 11");
  });
  it("stops at the day a finished job ended", () => {
    expect(dayStrip(plan, [], "2026-12-01", [], "2026-11-11")).toHaveLength(8);
  });
  it("gives a photo on a day off its own day", () => {
    const days = dayStrip(plan, [photo("2026-11-08T03:00:00Z")], "2026-11-09", []);
    expect(days.find((d) => d.date === "2026-11-08")).toMatchObject({ label: "Extra" });
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());
  });
});

describe("the day picked first", () => {
  const days = dayStrip(plan, [photo("2026-11-04T03:00:00Z")], "2026-11-06", []);
  it("is today when today is on the strip", () => expect(initialDay(days, "2026-11-06")).toBe(3));
  it("is otherwise the latest day with photos", () => expect(initialDay(days, "2026-12-25")).toBe(1));
});

describe("paging a long strip", () => {
  it("keeps the picked day in view", () => {
    expect(pageStart(13, 30, 8)).toBe(9);
    expect(pageStart(29, 30, 8)).toBe(22);
    expect(pageStart(2, 30, 8)).toBe(0);
    expect(pageStart(3, 7, 8)).toBe(0);
  });
});

describe("words", () => {
  it("reads the Malaysian time", () => {
    expect(mytTime("2026-11-06T01:15:00Z")).toBe("9:15");
    expect(mytDate("2026-11-05T17:00:00Z")).toBe("2026-11-06");
  });
  const mats = [{ id: "a" }, { id: "b" }, { id: "c" }] as unknown as MaterialRow[];
  it("tallies the board's line", () => {
    const st = { a: { state: "received" }, b: { state: "po", eta: "2026-11-10" }, c: { state: "short" } } as unknown as Record<string, MaterialStatus>;
    expect(materialTally(mats, st, (d) => d.replace(/-/g, "/"))).toMatchObject({ ready: false, readyCount: 1, tally: "1 of 3 ready · 1 arriving 2026/11/10 · 1 no PO yet" });
  });
  it("an order with no materials is ready", () => expect(materialTally([], undefined, (d) => d).ready).toBe(true));
  it("shows the calculation only for a composition", () => {
    const works = [{ qty: 120, uom: "SQFT" }];
    expect(materialCalculation({ qty_needed: "60.000", from_composition: true, added_how: "LISTED" }, works)).toBe("120 SQFT × 0.5");
    expect(materialCalculation({ qty_needed: 60, from_composition: false, added_how: "LISTED" }, works)).toBe("Listed");
    expect(materialCalculation({ qty_needed: 60, from_composition: true, added_how: "REQUESTED" }, works)).toBe("Requested");
  });
});
