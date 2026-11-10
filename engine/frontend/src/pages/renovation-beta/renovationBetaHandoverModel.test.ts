import { describe, expect, it } from "vitest";
import type { CheckItem, HandoverCheck, QueueCheck, QueueDefect } from "./renovationBetaHandoverApi";
import {
  cleanRows, currentCheck, failPrefill, inTab, itemsByArea, matchesSearch, moveRow, progressLine, queueByProject, sortQueue, tabCounts,
} from "./renovationBetaHandoverModel";

const item = (id: number, area: string | null, over: Partial<CheckItem> = {}): CheckItem => ({
  id, area, item: `Item ${id}`, criteria: null, result: null, note: null, defectId: null, defectState: null, checkedAt: null, checkedByName: null, ...over,
});
const check = (id: number, completedAt: string | null): HandoverCheck => ({
  id, templateName: "T", startedAt: null, startedByName: null, completedAt, completedByName: null,
  progress: { total: 0, checked: 0, passed: 0, failed: 0, na: 0, open: 0 }, items: [],
});
const defect = (id: number, over: Partial<QueueDefect> = {}): QueueDefect => ({
  id, projectId: 1, projectCode: "RN-1", projectName: "Maple", customerName: "Tan", location: "Kitchen", description: "Gap", trade: null,
  dueDate: null, reportedAt: null, fixedAt: null, redoCount: 0, assigneeId: null, assigneeName: null, assigneePhone: null, photoKey: null, ...over,
});
const TODAY = "2026-11-10";

describe("the handover check", () => {
  it("groups items under their area in the template's order; no area is General", () => {
    const g = itemsByArea([item(1, "Kitchen"), item(2, "Bath"), item(3, "Kitchen"), item(4, null)]);
    expect(g.map((x) => [x.area, x.items.map((i) => i.id)])).toEqual([["Kitchen", [1, 3]], ["Bath", [2]], ["General", [4]]]);
  });

  it("shows the open check, else the newest finished one", () => {
    expect(currentCheck([check(3, "2026-11-09T00:00:00Z"), check(2, null)])?.id).toBe(2);
    expect(currentCheck([check(3, "2026-11-09T00:00:00Z"), check(1, "2026-11-01T00:00:00Z")])?.id).toBe(3);
    expect(currentCheck([])).toBeNull();
  });

  it("says the progress in words", () => {
    expect(progressLine({ total: 20, checked: 12, failed: 2 })).toBe("12 of 20 checked · 2 failed");
    expect(progressLine({ total: 3, checked: 0, failed: 0 })).toBe("0 of 3 checked");
  });

  it("fills the defect report from the failed item", () => {
    expect(failPrefill({ area: "Kitchen", item: "Sink", note: null })).toEqual({ location: "Kitchen", description: "Sink" });
    expect(failPrefill({ area: null, item: "Door", note: "scratched" })).toEqual({ location: "", description: "Door: scratched" });
  });
});

describe("the checklist editor", () => {
  it("drops blank rows and trims", () => {
    expect(cleanRows([{ area: " Kitchen ", item: " Sink ", criteria: "" }, { area: "", item: "", criteria: "" }, { area: null, item: "Door", criteria: " ok " }]))
      .toEqual([{ area: "Kitchen", item: "Sink", criteria: null }, { area: null, item: "Door", criteria: "ok" }]);
  });
  it("keeps a row with an area but nothing to check, so the server can say what is missing", () => {
    expect(cleanRows([{ area: "Kitchen", item: "", criteria: null }])).toEqual([{ area: "Kitchen", item: "", criteria: null }]);
  });
  it("moves a row up or down, not past either end", () => {
    expect(moveRow(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("the defect queue", () => {
  const list = [
    defect(1, { dueDate: "2026-11-05" }), // 5 days late
    defect(2, { dueDate: "2026-11-20", assigneeId: 4, assigneeName: "Ali" }),
    defect(3, { fixedAt: "2026-11-09T02:00:00Z", dueDate: "2026-11-01" }), // fixed: never overdue
    defect(4, { projectId: 2, projectCode: "RN-2", projectName: "Oak", dueDate: "2026-11-09" }), // 1 day late
  ];

  it("counts each tab", () => {
    expect(tabCounts(list, TODAY)).toEqual({ all: 4, to_fix: 3, check: 1, overdue: 2, unassigned: 2 });
    expect(inTab(list[2]!, "overdue", TODAY)).toBe(false);
    expect(inTab(list[1]!, "unassigned", TODAY)).toBe(false);
  });

  it("matches each typed word on its own", () => {
    expect(matchesSearch(list[1]!, "ali kitchen")).toBe(true);
    expect(matchesSearch(list[1]!, "maple bath")).toBe(false);
    expect(matchesSearch(list[3]!, "  rn-2 ")).toBe(true);
    expect(matchesSearch(list[0]!, "")).toBe(true);
  });

  it("puts the most overdue first, then the nearest fix-by date, none last", () => {
    expect(sortQueue([defect(9), ...list], TODAY).map((d) => d.id)).toEqual([1, 4, 3, 2, 9]);
  });

  it("groups under each project, the worst project first, and lists a project with only an open check", () => {
    const k: QueueCheck = { id: 7, projectId: 3, projectCode: "RN-3", projectName: "Elm", templateName: "T", startedAt: null, startedByName: null, total: 10, checked: 4, failed: 1 };
    const g = queueByProject(list, [k], TODAY);
    expect(g.map((p) => [p.label, p.defects.map((d) => d.id), p.check?.id ?? null])).toEqual([
      ["RN-1 · Maple", [1, 3, 2], null],
      ["RN-2 · Oak", [4], null],
      ["RN-3 · Elm", [], 7],
    ]);
  });
});
