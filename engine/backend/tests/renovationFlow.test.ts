import { describe, expect, test } from "vitest";
import {
  activeSteps,
  derivedFlowStep,
  effectiveFlowStep,
  isFullyPaid,
  type FlowFacts,
  type FlowStepRow,
} from "../src/services/renovation/flow";

const STEPS: FlowStepRow[] = [
  { step_key: "design", label: "Design", sort_order: 10, active: true },
  { step_key: "signed", label: "Signed", sort_order: 20, active: true },
  { step_key: "ordering", label: "Ordering", sort_order: 30, active: true },
  { step_key: "renovation", label: "Renovation", sort_order: 40, active: true },
  { step_key: "handover", label: "Handover", sort_order: 50, active: true },
  { step_key: "closed", label: "Closed", sort_order: 60, active: true },
];

const none: FlowFacts = { hasSo: false, hasPoLine: false, taskStarted: false, handedOver: false, contractSen: null, receivedSen: 0, closedAt: null };

describe("derived step: the furthest step whose data is there", () => {
  test("a new project is in design", () => {
    expect(derivedFlowStep(STEPS, none)).toBe("design");
  });
  test("an SO means signed; a PO line means ordering; a started task means renovation", () => {
    expect(derivedFlowStep(STEPS, { ...none, hasSo: true })).toBe("signed");
    expect(derivedFlowStep(STEPS, { ...none, hasSo: true, hasPoLine: true })).toBe("ordering");
    expect(derivedFlowStep(STEPS, { ...none, hasSo: true, hasPoLine: true, taskStarted: true })).toBe("renovation");
  });
  test("a signed handover is handover; closed needs it fully paid too", () => {
    const ho = { ...none, hasSo: true, handedOver: true, contractSen: 100_00, receivedSen: 50_00 };
    expect(derivedFlowStep(STEPS, ho)).toBe("handover");
    expect(derivedFlowStep(STEPS, { ...ho, receivedSen: 100_00 })).toBe("closed");
  });
  test("fully paid without a handover does not close", () => {
    expect(derivedFlowStep(STEPS, { ...none, hasSo: true, contractSen: 1, receivedSen: 1 })).toBe("signed");
  });
  test("closed_at closes whatever else is true", () => {
    expect(derivedFlowStep(STEPS, { ...none, closedAt: "2026-10-01" })).toBe("closed");
  });
  test("data out of order still lands on the furthest step (handover without an SO)", () => {
    expect(derivedFlowStep(STEPS, { ...none, handedOver: true })).toBe("handover");
  });
  test("an inactive step is never the answer: the step before it is", () => {
    const steps = STEPS.map((s) => (s.step_key === "ordering" ? { ...s, active: false } : s));
    expect(derivedFlowStep(steps, { ...none, hasSo: true, hasPoLine: true })).toBe("signed");
    expect(activeSteps(steps).map((s) => s.step_key)).not.toContain("ordering");
  });
  test("the company's order decides 'furthest'", () => {
    const steps = STEPS.map((s) => (s.step_key === "ordering" ? { ...s, sort_order: 45 } : s));
    expect(derivedFlowStep(steps, { ...none, hasSo: true, hasPoLine: true, taskStarted: true })).toBe("ordering");
  });
  test("a zero contract is never fully paid", () => {
    expect(isFullyPaid(0, 0)).toBe(false);
    expect(isFullyPaid(null, 10)).toBe(false);
    expect(isFullyPaid(100, 100)).toBe(true);
  });
});

describe("manual step: holds until the data moves past it", () => {
  test("no manual step: the data decides", () => {
    const r = effectiveFlowStep(STEPS, "signed", null);
    expect(r).toMatchObject({ current: "signed", derived: "signed", manualInEffect: false });
  });
  test("moved forward by hand: holds while the data is behind it", () => {
    const r = effectiveFlowStep(STEPS, "signed", { step: "renovation", base: "signed" });
    expect(r).toMatchObject({ current: "renovation", manualInEffect: true });
  });
  test("forward move released once the data passes it", () => {
    expect(effectiveFlowStep(STEPS, "handover", { step: "renovation", base: "signed" })).toMatchObject({ current: "handover", manualInEffect: false });
    expect(effectiveFlowStep(STEPS, "renovation", { step: "renovation", base: "signed" })).toMatchObject({ current: "renovation", manualInEffect: true });
  });
  test("moved back by hand: holds until the data moves past where it was when set", () => {
    const m = { step: "signed" as const, base: "renovation" as const };
    expect(effectiveFlowStep(STEPS, "renovation", m)).toMatchObject({ current: "signed", manualInEffect: true });
    expect(effectiveFlowStep(STEPS, "handover", m)).toMatchObject({ current: "handover", manualInEffect: false });
  });
  test("a manual close holds for good", () => {
    expect(effectiveFlowStep(STEPS, "ordering", { step: "closed", base: "ordering" })).toMatchObject({ current: "closed", manualInEffect: true });
  });
  test("a manual step the company switched off is ignored", () => {
    const steps = STEPS.map((s) => (s.step_key === "ordering" ? { ...s, active: false } : s));
    expect(effectiveFlowStep(steps, "signed", { step: "ordering", base: "signed" })).toMatchObject({ current: "signed", manualInEffect: false });
  });
  test("the answer carries the step list with labels and the current index", () => {
    const r = effectiveFlowStep(STEPS, "ordering", null);
    expect(r.steps.map((s) => s.label)).toEqual(["Design", "Signed", "Ordering", "Renovation", "Handover", "Closed"]);
    expect(r.currentIndex).toBe(2);
    expect(r.currentLabel).toBe("Ordering");
  });
});
