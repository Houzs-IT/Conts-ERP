import { describe, expect, it } from "vitest";
import { belowSpent, kindWord, mytDay, pctFromBp, senFromRm } from "./renoCostReviewQueries";

// The expected-cost review on Renovation Projects (SOP 4.2.1; plan 2026-11-02 Task 4): the amounts typed in RM, the
// warning below the cost spent, and the alert kinds in words.
describe("expected-cost review helpers", () => {
  it("reads an RM amount the way people type it", () => {
    expect(senFromRm("75,000")).toBe(7_500_000);
    expect(senFromRm(" 75000.5 ")).toBe(7_500_050);
    expect(senFromRm("RM 1,234.56")).toBe(123_456);
    expect(senFromRm("")).toBeNull();
    expect(senFromRm("abc")).toBeNull();
    expect(senFromRm("1.234")).toBeNull();
  });

  it("warns when the new figure is below the cost already spent", () => {
    expect(belowSpent(5_000_000, 5_500_000)).toBe(true);
    expect(belowSpent(5_500_000, 5_500_000)).toBe(false);
  });

  it("shows the percentage setting as a plain number", () => {
    expect(pctFromBp(500)).toBe("5");
    expect(pctFromBp(250)).toBe("2.5");
  });

  it("names each alert kind", () => {
    expect(kindWord("LINE_OVER")).toBe("Line over budget");
    expect(kindWord("LINE_UNDER")).toBe("Line under budget");
    expect(kindWord("PROJECT_OVER")).toBe("Project over expected cost");
  });
});

describe("mytDay", () => {
  it("is the day in Malaysia", () => {
    expect(mytDay("2026-11-19T23:30:00Z")).toBe("2026-11-20");
    expect(mytDay("2026-11-20T15:59:00Z")).toBe("2026-11-20");
  });
});
