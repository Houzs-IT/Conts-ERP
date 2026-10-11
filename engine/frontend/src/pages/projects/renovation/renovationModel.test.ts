import { describe, expect, it } from "vitest";
import {
  activeOn, addDays, barPlacement, blockerText, dateRange, daysBetween, errorText, money, shiftRange, supplyLabel, supplyTone, weekStart,
} from "./renovationModel";
import { toggleStage } from "./ProjectTypeManager";
import { doerText, groupByContractor } from "./RenovationCalendar";
import { matchesBoardFilter } from "./RenovationBoard";
import type { CalendarTask } from "./renovationApi";
import type { BoardRowV2 } from "./simpleApi";

describe("renovation model", () => {
  it("labels and tones for the derived supply conditions", () => {
    expect(supplyLabel("pending_purchased")).toBe("Pending purchased");
    expect(supplyLabel(null)).toBe("Not available");
    expect(supplyTone("all_arrived")).toBe("ok");
    expect(supplyTone("pending_purchased")).toBe("warn");
  });

  it("date maths for the calendar", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(dateRange("2026-10-30", "2026-11-01")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weekStart("2026-10-09")).toBe("2026-10-05"); // Friday -> Monday
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
  });

  it("drag keeps the task's length; a one-date task moves its date", () => {
    expect(shiftRange("2026-10-20", "2026-10-22", 3)).toEqual({ start: "2026-10-23", end: "2026-10-25" });
    expect(shiftRange(null, "2026-10-22", -2)).toEqual({ start: null, end: "2026-10-20" });
  });

  it("bar placement clips to the window", () => {
    expect(barPlacement("2026-10-06", "2026-10-08", "2026-10-05", "2026-10-25")).toEqual({ col: 1, span: 3, clippedStart: false, clippedEnd: false });
    expect(barPlacement("2026-10-01", "2026-10-06", "2026-10-05", "2026-10-25")).toEqual({ col: 0, span: 2, clippedStart: true, clippedEnd: false });
    expect(barPlacement("2026-10-26", "2026-10-28", "2026-10-05", "2026-10-25")).toBeNull();
    expect(barPlacement(null, null, "2026-10-05", "2026-10-25")).toBeNull();
    expect(barPlacement("2026-10-10", null, "2026-10-05", "2026-10-25")).toMatchObject({ col: 5, span: 1 });
  });

  it("tasks active on a day", () => {
    const t = [{ planned_start: "2026-10-10", planned_end: "2026-10-12" }, { planned_start: null, planned_end: "2026-10-11" }, { planned_start: null, planned_end: null }];
    expect(activeOn(t, "2026-10-11")).toHaveLength(2);
    expect(activeOn(t, "2026-10-12")).toHaveLength(1);
  });

  it("stage blockers and server errors read as sentences", () => {
    expect(blockerText(["checklist_open:3", "pod_missing:1", "handover_unsigned"])).toBe("3 checklist items open, 1 lines without proof of delivery, handover form not signed");
    expect(errorText({ rawBody: JSON.stringify({ error: "stage_blocked", blockers: ["tasks_open:2"] }) })).toBe("This stage still has open items. 2 tasks not done.");
    expect(errorText({ rawBody: JSON.stringify({ error: "hardware_gate_closed", reasons: ["so_missing"], messages: ["No renovation sales order is linked to this project yet."] }) }))
      .toBe("Not ready for site works yet. No renovation sales order is linked to this project yet.");
    expect(errorText({ rawBody: JSON.stringify({ error: "snags_open", message: "Close every snag first." }) })).toBe("Close every snag first.");
    expect(errorText(new Error("network down"))).toBe("network down");
  });

  it("money in sen", () => {
    expect(money(1234567)).toBe("RM 12,345.67");
    expect(money(null)).toBe("-");
  });
});

describe("project type stages", () => {
  it("design, handover and closed cannot be turned off; order follows the stage list", () => {
    expect(toggleStage(["design", "handover", "closed"], "design")).toEqual(["design", "handover", "closed"]);
    expect(toggleStage(["design", "handover", "closed"], "furniture")).toEqual(["design", "furniture", "handover", "closed"]);
    expect(toggleStage(["design", "furniture", "handover", "closed"], "furniture")).toEqual(["design", "handover", "closed"]);
  });
});

describe("calendar grouping and board filter", () => {
  const task = (id: number, kind: string, supplier: string | null): CalendarTask => ({
    id, project_id: 1, project_code: "RN-1", project_name: "P", building: null, unit_no: null, stage_key: "hardware", trade_code: "X",
    label: "X", fulfilment_kind: kind, state: "open", supplier_id: supplier, supplier_name: supplier ? `S-${supplier}` : null, po_number: null,
    planned_start: "2026-10-10", planned_end: "2026-10-11", status: "planned",
  });
  it("groups tasks by contractor, in-house crew by who is on it", () => {
    const crew = (t: CalendarTask, names: Array<[number, string]>) => ({ ...t, assignees: names.map(([id, name]) => ({ id, name })) });
    const g = groupByContractor([task(1, "po", "b"), task(2, "internal", null), task(3, "po", "a"), task(4, "po", "a"), task(5, "po", null),
      crew(task(6, "internal", null), [[7, "INHOUSE - ZAINAL"]]), crew(task(7, "internal", null), [[7, "INHOUSE - ZAINAL"]])]);
    expect(g.map((x) => [x.name, x.tasks.length])).toEqual([["In-house (no crew yet)", 1], ["In-house: INHOUSE - ZAINAL", 2], ["No subcontractor yet", 1], ["S-a", 2], ["S-b", 1]]);
  });
  it("names who does a task", () => {
    expect(doerText({ fulfilment_kind: "internal", supplier_name: null, assignees: [{ id: 1, name: "MONIR" }, { id: 2, name: "SEY" }] })).toBe("In-house: MONIR, SEY");
    expect(doerText({ fulfilment_kind: "po", supplier_name: "YILLON", assignees: [] })).toBe("YILLON");
  });
  it("board search matches every word across building, unit, customer, SO", () => {
    const r = { code: "RN-2610-001", name: "Skyline A-12-3", building: "Skyline", unitNo: "A-12-3", customerName: "Ms Lim", soDocNo: "SO-1",
      sales: { personId: 1, name: "Ali" }, step: { key: "renovation" }, hold: null } as unknown as BoardRowV2;
    expect(matchesBoardFilter(r, "skyline lim", "")).toBe(true);
    expect(matchesBoardFilter(r, "skyline ali", "")).toBe(true);
    expect(matchesBoardFilter(r, "skyline tan", "")).toBe(false);
    expect(matchesBoardFilter(r, "", "signed")).toBe(false);
    expect(matchesBoardFilter(r, "", "renovation")).toBe(true);
    expect(matchesBoardFilter(r, "", "hold")).toBe(false);
    expect(matchesBoardFilter({ ...r, hold: { flag: "in_defect", label: "IN DEFECT", note: null } }, "", "hold")).toBe(true);
  });
});
