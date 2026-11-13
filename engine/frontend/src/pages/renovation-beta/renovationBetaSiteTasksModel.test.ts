import { describe, expect, test } from "vitest";
import type { SiteTask, SiteTaskBoard } from "./renovationBetaSiteTasksApi";
import { EVERYONE, brandOptions, groupByProject, matchesFilters, tabCounts, tasksOfTab, whoLine, whoOptions } from "./renovationBetaSiteTasksModel";

function siteTask(overrides: Partial<SiteTask>): SiteTask {
  return {
    id: 1, projectId: 7, projectCode: "RN-0007", projectName: "Vortex A-12-03", building: "Vortex", unitNo: "A-12-03", brand: null,
    label: "Painting", isSubcontracted: false, supplierName: null, crew: [], plannedStart: null, plannedEnd: null,
    finishedOn: null, lastPhotoAt: null, status: "planned",
    ...overrides,
  };
}

const board: SiteTaskBoard = {
  open: [
    siteTask({ id: 1, status: "overdue", crew: [{ id: 3, name: "Ali" }] }),
    siteTask({ id: 2, status: "late_start", isSubcontracted: true, supplierName: "Ah Seng Tiling" }),
    siteTask({ id: 3, status: "in_progress", crew: [{ id: 4, name: "Kumar" }], projectId: 8, projectName: "Arte B-08-01", brand: "The Conts" }),
    siteTask({ id: 4, status: "unscheduled" }),
    siteTask({ id: 5, status: "planned", isSubcontracted: true }),
  ],
  history: [siteTask({ id: 6, status: "done" })],
  isTruncated: false,
};

describe("site task board tabs", () => {
  test("late covers overdue and not started; no one on it covers crewless and contractorless tasks", () => {
    expect(tasksOfTab(board, "late").map((task) => task.id)).toEqual([1, 2]);
    expect(tasksOfTab(board, "no_one").map((task) => task.id)).toEqual([4, 5]);
    expect(tasksOfTab(board, "history").map((task) => task.id)).toEqual([6]);
  });

  test("each tab counts what it shows", () => {
    expect(tabCounts(board)).toEqual({ open: 5, late: 2, in_progress: 1, planned: 1, no_dates: 1, no_one: 2, history: 1 });
  });
});

describe("site task filters", () => {
  test("who lists crew by name and contractors marked as such, sorted", () => {
    expect(whoOptions(board.open)).toEqual([
      { value: "supplier:Ah Seng Tiling", label: "Ah Seng Tiling (contractor)" },
      { value: "crew:3", label: "Ali" },
      { value: "crew:4", label: "Kumar" },
    ]);
  });

  test("a person filter keeps only their tasks; search matches every word anywhere", () => {
    expect(board.open.filter((task) => matchesFilters(task, "crew:3", "")).map((task) => task.id)).toEqual([1]);
    expect(board.open.filter((task) => matchesFilters(task, EVERYONE, "arte kumar")).map((task) => task.id)).toEqual([3]);
  });

  test("who line names the crew, the contractor, or says no one yet", () => {
    expect(whoLine(board.open[0])).toBe("Ali");
    expect(whoLine(board.open[1])).toBe("Contractor: Ah Seng Tiling");
    expect(whoLine(board.open[3])).toBe("No crew yet");
    expect(whoLine(board.open[4])).toBe("No contractor yet");
  });

  test("tasks group under their project in first-seen order", () => {
    expect(groupByProject(board.open).map((group) => [group.label, group.brand, group.tasks.length])).toEqual([["Vortex A-12-03", null, 4], ["Arte B-08-01", "The Conts", 1]]);
  });

  test("brands list each named brand once, sorted; search finds a brand", () => {
    expect(brandOptions([...board.open, siteTask({ brand: "Dream Crafter" }), siteTask({ brand: "The Conts" })])).toEqual(["Dream Crafter", "The Conts"]);
    expect(board.open.filter((task) => matchesFilters(task, EVERYONE, "conts")).map((task) => task.id)).toEqual([3]);
  });
});
