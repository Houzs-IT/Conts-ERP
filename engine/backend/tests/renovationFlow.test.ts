import { describe, expect, test } from "vitest";
import {
  activeSteps,
  derivedFlowStep,
  effectiveFlowStep,
  flowStages,
  isFullyPaid,
  stageComplete,
  type FlowFacts,
  type FlowStepRow,
} from "../src/services/renovation/flow";

/* The rows as migration 0083 seeded them: Design before Signed. The flow puts Sales order first (owner, 19 Nov 2026). */
const STEPS: FlowStepRow[] = [
  { step_key: "design", label: "Design", sort_order: 10, active: true },
  { step_key: "signed", label: "Sales order", sort_order: 20, active: true },
  { step_key: "ordering", label: "Ordering", sort_order: 30, active: true },
  { step_key: "renovation", label: "Renovation", sort_order: 40, active: true },
  { step_key: "handover", label: "Handover", sort_order: 50, active: true },
  { step_key: "closed", label: "Closed", sort_order: 60, active: true },
];

const none: FlowFacts = {
  hasSo: false, firstPaymentReceived: false, designDone: false, hasVo: false, renovationDone: false, handedOver: false,
  contractSen: null, receivedSen: 0, closedAt: null,
};
const paid: FlowFacts = { ...none, hasSo: true, firstPaymentReceived: true, contractSen: 100_00, receivedSen: 10_00 };
const all: FlowFacts = { ...paid, designDone: true, hasVo: true, renovationDone: true, handedOver: true };

describe("order: Sales order comes first", () => {
  test("the seeded order (Design before Signed) is read with Sales order first, the rest kept", () => {
    expect(activeSteps(STEPS).map((s) => s.step_key)).toEqual(["signed", "design", "ordering", "renovation", "handover", "closed"]);
  });
  test("no rows: the default list is in the owner's order", () => {
    expect(activeSteps([]).map((s) => s.step_key)).toEqual(["signed", "design", "ordering", "renovation", "handover", "closed"]);
  });
});

describe("derived stage: the first stage that is not complete", () => {
  test("no sales order: Sales order", () => {
    expect(derivedFlowStep(STEPS, none)).toBe("signed");
  });
  test("linked but nothing received: Sales order is complete yet the project waits there", () => {
    const f = { ...none, hasSo: true };
    expect(stageComplete("signed", f)).toBe(true);
    expect(derivedFlowStep(STEPS, f)).toBe("signed");
    const signed = flowStages(STEPS, f, [], []).find((s) => s.key === "signed")!;
    expect(signed).toMatchObject({ complete: true, waiting: true, state: "Waiting first payment" });
  });
  test("first payment received: Design", () => {
    expect(derivedFlowStep(STEPS, paid)).toBe("design");
  });
  test("a payment without a linked order does not pass Sales order", () => {
    expect(derivedFlowStep(STEPS, { ...none, firstPaymentReceived: true })).toBe("signed");
  });
  test("design done: Ordering; a variation order: Renovation; every category: Handover", () => {
    expect(derivedFlowStep(STEPS, { ...paid, designDone: true })).toBe("ordering");
    expect(derivedFlowStep(STEPS, { ...paid, designDone: true, hasVo: true })).toBe("renovation");
    expect(derivedFlowStep(STEPS, { ...paid, designDone: true, hasVo: true, renovationDone: true })).toBe("handover");
  });
  test("a later stage complete does not skip an open earlier one", () => {
    expect(derivedFlowStep(STEPS, { ...paid, hasVo: true, renovationDone: true, handedOver: true })).toBe("design");
  });
  test("handed over: Closed is next; Close without full settlement does not complete it", () => {
    expect(derivedFlowStep(STEPS, all)).toBe("closed");
    expect(stageComplete("closed", { ...all, closedAt: "2026-11-19" })).toBe(false);
    expect(flowStages(STEPS, { ...all, closedAt: "2026-11-19" }, [], []).find((s) => s.key === "closed")!.state).toBe("Closed, waiting full payment");
  });
  test("Close pressed and fully settled: Closed is complete; settled alone is not", () => {
    expect(stageComplete("closed", { ...all, closedAt: "2026-11-19", receivedSen: 100_00 })).toBe(true);
    expect(stageComplete("closed", { ...all, receivedSen: 100_00 })).toBe(false);
    expect(derivedFlowStep(STEPS, { ...all, closedAt: "2026-11-19", receivedSen: 100_00 })).toBe("closed");
  });
  test("an inactive stage is skipped", () => {
    const steps = STEPS.map((s) => (s.step_key === "ordering" ? { ...s, active: false } : s));
    expect(derivedFlowStep(steps, { ...paid, designDone: true })).toBe("renovation");
    expect(activeSteps(steps).map((s) => s.step_key)).not.toContain("ordering");
  });
  test("a zero contract is never fully paid", () => {
    expect(isFullyPaid(0, 0)).toBe(false);
    expect(isFullyPaid(null, 10)).toBe(false);
    expect(isFullyPaid(100, 100)).toBe(true);
  });
});

describe("stage statuses", () => {
  test("every active stage in order, with Design steps and Renovation categories attached", () => {
    const design = [{ code: "measure", label: "Site measure", done: true, date: "2026-11-01", state: "Measured" }];
    const cats = [
      { code: "CARPENTRY", label: "Carpentry", onProject: true, done: false, linesDone: 1, linesTotal: 2 },
      { code: "LIGHTING", label: "Lighting", onProject: false, done: false, linesDone: 0, linesTotal: 0 },
    ];
    const st = flowStages(STEPS, paid, design, cats);
    expect(st.map((s) => s.key)).toEqual(["signed", "design", "ordering", "renovation", "handover", "closed"]);
    expect(st[0]).toMatchObject({ complete: true, waiting: false, state: "First payment received" });
    expect(st[1]).toMatchObject({ complete: false, state: "1 of 1 steps done", designSteps: design });
    expect(st[2]).toMatchObject({ complete: false, state: "No variation order yet" });
    expect(st[3]).toMatchObject({ complete: false, state: "0 of 1 categories complete", categories: cats });
    expect(st[1].categories).toBeUndefined();
    expect(st[3].designSteps).toBeUndefined();
  });
});

describe("manual step: holds until the data moves past it", () => {
  test("no manual step: the data decides", () => {
    const r = effectiveFlowStep(STEPS, "design", null);
    expect(r).toMatchObject({ current: "design", derived: "design", manualInEffect: false });
  });
  test("moved forward by hand: holds while the data is behind it", () => {
    const r = effectiveFlowStep(STEPS, "design", { step: "renovation", base: "design" });
    expect(r).toMatchObject({ current: "renovation", manualInEffect: true });
  });
  test("forward move released once the data passes it", () => {
    expect(effectiveFlowStep(STEPS, "handover", { step: "renovation", base: "design" })).toMatchObject({ current: "handover", manualInEffect: false });
    expect(effectiveFlowStep(STEPS, "renovation", { step: "renovation", base: "design" })).toMatchObject({ current: "renovation", manualInEffect: true });
  });
  test("moved back by hand: holds until the data moves past where it was when set", () => {
    const m = { step: "design" as const, base: "renovation" as const };
    expect(effectiveFlowStep(STEPS, "renovation", m)).toMatchObject({ current: "design", manualInEffect: true });
    expect(effectiveFlowStep(STEPS, "handover", m)).toMatchObject({ current: "handover", manualInEffect: false });
  });
  test("a manual close holds for good", () => {
    expect(effectiveFlowStep(STEPS, "ordering", { step: "closed", base: "ordering" })).toMatchObject({ current: "closed", manualInEffect: true });
  });
  test("a manual step the company switched off is ignored", () => {
    const steps = STEPS.map((s) => (s.step_key === "ordering" ? { ...s, active: false } : s));
    expect(effectiveFlowStep(steps, "design", { step: "ordering", base: "design" })).toMatchObject({ current: "design", manualInEffect: false });
  });
  test("the answer carries the step list with labels and the current index", () => {
    const r = effectiveFlowStep(STEPS, "ordering", null);
    expect(r.steps.map((s) => s.label)).toEqual(["Sales order", "Design", "Ordering", "Renovation", "Handover", "Closed"]);
    expect(r.currentIndex).toBe(2);
    expect(r.currentLabel).toBe("Ordering");
  });
});
