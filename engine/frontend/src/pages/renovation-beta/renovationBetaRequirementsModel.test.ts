import { describe, expect, test } from "vitest";
import type { RequirementLine, RequirementProject } from "./renovationBetaRequirementsApi";
import { NO_ROOM, brandOptions, filterProjectLines, groupByRoom, onPoCount, roomSummary } from "./renovationBetaRequirementsModel";

function line(overrides: Partial<RequirementLine>): RequirementLine {
  return {
    id: "a", itemCode: "RN-PROTECTION", name: "Works - Protection", remark: null, qty: 1, uom: "UNIT",
    room: "Common area", group: "works", isOnPo: false,
    ...overrides,
  };
}

function project(overrides: Partial<RequirementProject>): RequirementProject {
  return { id: 13, code: "RN-2509-003", name: "BARON B11-07 MS LEE", brand: "The Conts", lines: [], ...overrides };
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

  test("on PO counts only lines a live PO holds", () => {
    expect(onPoCount([line({ isOnPo: true }), line({}), line({ isOnPo: true })])).toBe(2);
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
