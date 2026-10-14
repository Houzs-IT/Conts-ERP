import { describe, expect, test } from "vitest";
import { daysBetween, keyLogRows } from "./keyLog";

const TODAY = "2026-10-14";

describe("days between two dates", () => {
  test("whole calendar days, never negative", () => {
    expect(daysBetween("2026-10-01", "2026-10-14")).toBe(13);
    expect(daysBetween("2026-10-14", "2026-10-14")).toBe(0);
    expect(daysBetween("2026-02-27", "2026-03-02")).toBe(3);
    expect(daysBetween("2026-10-20", "2026-10-14")).toBe(0);
  });
});

describe("key log rows", () => {
  test("newest first; each move is held until the next one, the latest until today", () => {
    const rows = keyLogRows([
      { id: 1, moved_on: "2026-09-01" },
      { id: 3, moved_on: "2026-10-04" },
      { id: 2, moved_on: "2026-09-20" },
    ], TODAY);
    expect(rows.map((r) => [r.id, r.daysHeld, r.current])).toEqual([[3, 10, true], [2, 14, false], [1, 19, false]]);
  });
  test("two moves on the same day: the later recorded one is newer and the earlier held it 0 days", () => {
    const rows = keyLogRows([{ id: 5, moved_on: "2026-10-01" }, { id: 6, moved_on: "2026-10-01" }], TODAY);
    expect(rows.map((r) => [r.id, r.daysHeld])).toEqual([[6, 13], [5, 0]]);
  });
  test("no moves, no rows", () => {
    expect(keyLogRows([], TODAY)).toEqual([]);
  });
});
