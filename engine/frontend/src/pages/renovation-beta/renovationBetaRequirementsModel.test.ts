import { describe, expect, test } from "vitest";
import type { RequirementLine, RequirementProject, TradePlan } from "./renovationBetaRequirementsApi";
import {
  NO_ROOM, brandOptions, clampDoneQty, filterProjectLines, groupByRoom, groupByTrade, isLineDone, lineProgressText, onPoCount, planDates, progressText, roomSummary,
} from "./renovationBetaRequirementsModel";

function line(overrides: Partial<RequirementLine>): RequirementLine {
  return {
    id: "a", itemCode: "RN-PROTECTION", name: "Works - Protection", remark: null, qty: 1, uom: "UNIT",
    room: "Common area", group: "works", isOnPo: false, planKey: "PROTECTION", tradeLabel: null, onSiteBy: null, doneQty: 0, doneAt: null,
    ...overrides,
  };
}

function project(overrides: Partial<RequirementProject>): RequirementProject {
  return { id: 13, code: "RN-2509-003", name: "BARON B11-07 MS LEE", brand: "The Conts", lines: [], plans: [], ...overrides };
}

function plan(overrides: Partial<TradePlan>): TradePlan {
  return { taskId: 1, planKey: "ELECTRICAL", label: "WIRING & HACKING", plannedStart: null, plannedEnd: null, status: "unscheduled", ...overrides };
}

describe("requirement board grouping", () => {
  test("rooms keep the order they first appear in, and a line with no room goes under No room", () => {
    const rooms = groupByRoom([line({ id: "a" }), line({ id: "b", room: "Living hall" }), line({ id: "c" }), line({ id: "d", room: null })]);
    expect(rooms.map((room) => [room.name, room.lines.map((item) => item.id)])).toEqual([
      ["Common area", ["a", "c"]], ["Living hall", ["b"]], [NO_ROOM, ["d"]],
    ]);
  });

  test("each room splits into Works then Built-in, leaving out an empty card", () => {
    const [room] = groupByRoom([line({ id: "a", group: "builtin" }), line({ id: "b" }), line({ id: "c", group: "builtin" })]);
    expect(room.cards.map((card) => [card.label, card.lines.map((item) => item.id)])).toEqual([["Works", ["b"]], ["Built-in", ["a", "c"]]]);
    expect(roomSummary(room)).toBe("Works 1 · Built-in 2");
    expect(groupByRoom([line({})])[0].cards.map((card) => card.key)).toEqual(["works"]);
  });

  test("a line is done only when every unit is done, and lines done count only those", () => {
    const partly = line({ qty: 3, doneQty: 2 });
    const fully = line({ qty: 3, doneQty: 3 });
    expect([isLineDone(partly), isLineDone(fully), lineProgressText(partly)]).toEqual([false, true, "2 of 3"]);
    expect(progressText([fully, partly, line({})])).toBe("1 of 3 done");
  });

  test("units done stay between none and the line's qty", () => {
    expect([clampDoneQty(-1, 3), clampDoneQty(5, 3), clampDoneQty(Number.NaN, 3), clampDoneQty(2, 3)]).toEqual([0, 3, 0, 2]);
  });

  test("on PO counts only lines a live PO holds", () => {
    expect(onPoCount([line({ isOnPo: true }), line({}), line({ isOnPo: true })])).toBe(2);
  });
});

describe("requirement board plans", () => {
  test("Works lines group by trade with that trade's plans; a trade with no task has none", () => {
    const lines = [
      line({ id: "a", planKey: "ELECTRICAL", name: "Works - Electrical" }),
      line({ id: "b", planKey: "PROTECTION", name: "Works - Protection" }),
      line({ id: "c", planKey: "ELECTRICAL", name: "Works - Electrical" }),
    ];
    const trades = groupByTrade(lines, [plan({ taskId: 1 }), plan({ taskId: 2, label: "LIGHTING & FAN INSTALLATION" }), plan({ taskId: 3, planKey: "PAINTING" })]);
    expect(trades.map((trade) => [trade.label, trade.lines.map((item) => item.id), trade.plans.map((item) => item.taskId)])).toEqual([
      ["Electrical", ["a", "c"], [1, 2]], ["Protection", ["b"], []],
    ]);
  });

  test("the trade is named by its catalog label when the line's name is only a note", () => {
    const [trade] = groupByTrade([line({ name: "FLOOR PROTECTION", tradeLabel: "Protection" })], []);
    expect(trade.label).toBe("Protection");
  });

  test("Built-in lines sit under one Carpentry group with the carpentry plan", () => {
    const [trade] = groupByTrade([line({ group: "builtin", planKey: "BUILTIN", name: "Built-in - Wardrobe" })], [plan({ planKey: "BUILTIN", label: "CARPENTRY" })]);
    expect([trade.label, trade.plans.length]).toEqual(["Carpentry", 1]);
  });

  test("dates read as a range, a single day, or No dates", () => {
    expect(planDates({ plannedStart: "2026-02-11", plannedEnd: "2026-02-13" })).toMatch(/ to /);
    expect(planDates({ plannedStart: "2026-02-11", plannedEnd: "2026-02-11" })).not.toMatch(/ to /);
    expect(planDates({ plannedStart: null, plannedEnd: null })).toBe("No dates");
  });
});

describe("requirement board search and brands", () => {
  const baron = project({
    lines: [
      line({ id: "a", remark: "FLOOR PROTECTION" }),
      line({ id: "b", itemCode: "RN-WARDROBE", name: "Built-in - Wardrobe", group: "builtin", room: "Bedroom 1" }),
    ],
  });

  test("no search keeps every line; every word must match the project, room, SKU, name or remark", () => {
    expect(filterProjectLines(baron, " ").map((item) => item.id)).toEqual(["a", "b"]);
    expect(filterProjectLines(baron, "bedroom wardrobe").map((item) => item.id)).toEqual(["b"]);
    expect(filterProjectLines(baron, "floor").map((item) => item.id)).toEqual(["a"]);
    expect(filterProjectLines(baron, "baron").map((item) => item.id)).toEqual(["a", "b"]);
  });

  test("brands list each named brand once, sorted", () => {
    expect(brandOptions([baron, project({ brand: "Dream Crafter" }), project({ brand: null }), baron])).toEqual(["Dream Crafter", "The Conts"]);
  });
});
