import { describe, expect, it } from "vitest";
import { isOverdue, stagesOf, stepCaption, type TrailStep } from "./renovationDocTrailModel";

const step = (over: Partial<TrailStep>): TrailStep => ({ kind: "po", id: "1", no: "TC-PO-1", word: "Arrives", tone: "active", date: null, who: null, ...over });
const TODAY = "2026-11-27";

describe("stepCaption", () => {
  it("never leaves a connector hanging without a date", () => {
    expect(stepCaption(step({ date: "2026-11-25" }))).toBe("Arrives 25/11/2026");
    expect(stepCaption(step({}))).toBe("ETA pending");
    expect(stepCaption(step({ kind: "production", word: "Not started", tone: "wait", date: "2026-11-25" }))).toBe("Not started, due 25/11/2026");
    expect(stepCaption(step({ kind: "production", word: "Not started", tone: "wait" }))).toBe("Not started");
    expect(stepCaption(step({ kind: "do", word: "Confirmed", tone: "active" }))).toBe("Confirmed");
    expect(stepCaption(step({ kind: "so", word: "Confirmed", tone: "done" }))).toBe("Confirmed");
    expect(stepCaption(step({ kind: "so", word: "Confirmed", tone: "done", date: "2026-06-10" }))).toBe("Confirmed 10/06/2026");
  });
});

describe("isOverdue", () => {
  it("flags only open PO, production and DO dates before today", () => {
    expect(isOverdue(step({ date: "2026-11-20" }), TODAY)).toBe(true);
    expect(isOverdue(step({ date: "2026-11-27" }), TODAY)).toBe(false);
    expect(isOverdue(step({ date: "2026-11-20", tone: "done", word: "Received" }), TODAY)).toBe(false);
    expect(isOverdue(step({ kind: "so", word: "Draft", tone: "wait", date: "2026-06-10" }), TODAY)).toBe(false);
  });
});

describe("stagesOf", () => {
  it("folds several orders into one stage with the next date and the undated count", () => {
    const stages = stagesOf([
      step({ kind: "so", word: "Confirmed", tone: "done", date: "2026-06-10", no: "TC-SO-1" }),
      step({ id: "a", date: "2026-11-30" }), step({ id: "b" }), step({ id: "c" }),
      step({ kind: "production", id: "p", word: "Not started", tone: "wait", date: "2026-11-20" }),
      step({ kind: "production", id: "q", word: "Not started", tone: "wait" }),
    ], TODAY);
    expect(stages.map((s) => s.kind)).toEqual(["so", "po", "production", "gr", "do"]);
    expect(stages[1]).toMatchObject({ summary: "Next ETA 30/11/2026 · 2 pending ETA", overdue: false, tone: "active" });
    expect(stages[2]).toMatchObject({ summary: "Next due 20/11/2026 · 1 pending date", overdue: true });
    expect(stages[3]).toMatchObject({ summary: "Not yet", steps: [] });
  });
  it("says all done once nothing is open", () => {
    const [, po] = stagesOf([step({ id: "a", tone: "done", word: "Received" }), step({ id: "b", tone: "stopped", word: "Cancelled" })], TODAY);
    expect(po).toMatchObject({ summary: "1 done, 1 stopped", tone: "done" });
  });
});
