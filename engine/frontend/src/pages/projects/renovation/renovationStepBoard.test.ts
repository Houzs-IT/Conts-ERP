import { describe, expect, it } from "vitest";
import { boardColumns, splitClosed } from "./RenovationStepBoard";
import { slaText } from "./StepSlaParts";
import { shownGroups } from "./ProcurementPanel";
import type { BoardRowV2, ProcGroup } from "./simpleApi";
import type { ProjectRow } from "../types";

const steps = [
  { key: "design" as const, label: "Design" },
  { key: "signed" as const, label: "Signed" },
  { key: "closed" as const, label: "Closed" },
];
const row = (id: number) => ({ id, name: `P${id}` }) as unknown as ProjectRow;
const board = (id: number, step: string, extra: Partial<BoardRowV2> = {}) =>
  ({ id, step: { key: step, label: step }, endDate: null, handoverDate: null, ...extra }) as unknown as BoardRowV2;

describe("board by step", () => {
  it("puts each project in its step's column in list order and leaves out one without a step", () => {
    const byId = new Map([[1, board(1, "design")], [2, board(2, "closed")], [3, board(3, "design")]]);
    const cols = boardColumns([row(3), row(1), row(2), row(9)], byId, steps);
    expect(cols.get("design")!.map((c) => c.row.id)).toEqual([3, 1]);
    expect(cols.get("signed")).toEqual([]);
    expect(cols.get("closed")!.map((c) => c.row.id)).toEqual([2]);
  });

  it("Closed shows the last 30 days first, by the earlier of handover and closing", () => {
    const cards = [
      { row: row(1), board: board(1, "closed", { endDate: "2026-10-11", handoverDate: "2025-07-14" }) },
      { row: row(2), board: board(2, "closed", { endDate: "2026-10-10" }) },
      { row: row(3), board: board(3, "closed", { endDate: "2026-08-01" }) },
    ];
    const s = splitClosed(cards, "2026-10-16");
    expect(s.recent.map((c) => c.row.id)).toEqual([2]);
    expect(s.older.map((c) => c.row.id)).toEqual([3, 1]);
  });
});

describe("SLA line", () => {
  it("days in step against the days allowed, and how far over", () => {
    expect(slaText({ daysIn: 12, days: 14, overdueBy: null }, "Design")).toEqual({ main: "12 days in Design · SLA 14 days", overdue: null });
    expect(slaText({ daysIn: 1, days: null, overdueBy: null }, "Signed")).toEqual({ main: "1 day in Signed · No SLA", overdue: null });
    expect(slaText({ daysIn: 20, days: 14, overdueBy: 6 }, "Design").overdue).toBe("Overdue by 6 days");
  });
});

describe("procurement categories come from the sales order", () => {
  const g = (code: string, extra: Partial<ProcGroup> = {}) =>
    ({ code, label: code, poDate: null, deliveryDate: null, updatedAt: null, updatedBy: null, subs: [], ...extra }) as ProcGroup;
  const line = (cat: string) => ({ categoryGroup: cat, subCategory: null, qty: 1, orderedQty: 0, receivedQty: 0, deliveredQty: 0, grs: [], dos: [] });
  it("lists only categories with lines, plus any that already have planned dates", () => {
    const groups = [g("WORKS"), g("BUILT_IN"), g("LIGHTING", { poDate: "2026-11-01" }), g("SERVICE")];
    expect(shownGroups(groups, [line("WORKS")]).map((x) => x.code)).toEqual(["WORKS", "LIGHTING"]);
    expect(shownGroups([g("WORKS"), g("SERVICE")], [])).toEqual([]);
  });
});
