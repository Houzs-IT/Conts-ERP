import { describe, expect, test } from "vitest";
import { matchesSearch, matchesSelection, roleTabFor, rowReasons, selectionOf, selectionParam, type MonitorRow } from "./monitorModel";

const row = {
  id: 1, code: "RN-2610-001", name: "BARON C-20-08 MR ALBERT", building: "BARON", unitNo: "C-20-08", customerName: "MR ALBERT",
  soDocNo: null, soDate: null, sales: { personId: 1, name: "Michell" }, designer: { personId: 3, name: "JIA XIN" }, renoPic: { personId: null, name: null },
  contractSen: null, receivedSen: null, receivedPct: null, moneyHidden: false,
  step: { key: "design", label: "Design", index: 0, count: 6, manual: false },
  hold: { flag: "in_defect", label: "IN DEFECT", note: null }, statusText: "IN DEFECT · Design",
  furnitureArrival: null, renoItemArrival: null, keyHolder: null, vo: null, handoverDate: null, plannedHandoverDate: null,
  redFlagCount: 0, archived: false, createdAt: "2026-10-01", siteMeasured: true, has2d: false, has3d: true,
  scheduledTasks: 1, overdueTasks: 2, openTasks: 2, worksBeforeGateText: null, crewIds: [7], openQuotation: null, openVo: null,
  queues: ["sales_no_so", "design_in_design", "design_files_missing", "reno_overdue", "boss_in_defect"],
  flags: ["in_defect", "task_overdue"],
} as unknown as MonitorRow;

describe("selection: what a tile or flag opens", () => {
  test("round-trips through the URL", () => {
    for (const raw of ["queue:sales_no_so", "flag:in_defect", "step:design", "hold:on_hold"]) expect(selectionParam(selectionOf(raw))).toBe(raw);
    expect(selectionOf(null)).toEqual({ kind: "all" });
    expect(selectionOf("bogus:x")).toEqual({ kind: "all" });
  });
  test("matches queues, flags, steps and holds", () => {
    expect(matchesSelection(row, selectionOf("queue:design_in_design"))).toBe(true);
    expect(matchesSelection(row, selectionOf("queue:reno_to_arrange"))).toBe(false);
    expect(matchesSelection(row, selectionOf("flag:task_overdue"))).toBe(true);
    expect(matchesSelection(row, selectionOf("step:signed"))).toBe(false);
    expect(matchesSelection(row, selectionOf("hold:in_defect"))).toBe(true);
    expect(matchesSelection(row, { kind: "all" })).toBe(true);
  });
});

describe("search and tabs", () => {
  test("every word must match building, customer or the people", () => {
    expect(matchesSearch(row, "baron albert")).toBe(true);
    expect(matchesSearch(row, "jia")).toBe(true);
    expect(matchesSearch(row, "baron chong")).toBe(false);
    expect(matchesSearch(row, "  ")).toBe(true);
  });
  test("a person's roles pick their tab", () => {
    expect(roleTabFor(["sales"])).toBe("sales");
    expect(roleTabFor(["sales", "boss"])).toBe("boss");
    expect(roleTabFor(["designer"])).toBe("design");
    expect(roleTabFor(["site_crew"])).toBe("renovation");
    expect(roleTabFor(["admin"])).toBe("admin");
    expect(roleTabFor([])).toBeNull();
  });
  test("reasons say why a row is in a queue", () => {
    expect(rowReasons(row, undefined)).toEqual(["2D missing", "2 late tasks"]);
  });
});
