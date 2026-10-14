import { describe, expect, test } from "vitest";
import { RENO_ESTIMATE_DAYS, renovationCalendarSpan, spanOverlaps } from "../src/services/renovation/calendarSpan";

const base = { createdAt: "2026-10-01T03:00:00Z", plannedHandover: null, handedOverAt: null, slaDays: null };

describe("calendar bar of a renovation project (owner, 14 Oct 2026)", () => {
  test("from the created date (Malaysia time) to the planned handover", () => {
    expect(renovationCalendarSpan({ ...base, plannedHandover: "2026-11-20" }))
      .toEqual({ start: "2026-10-01", end: "2026-11-20", endBasis: "planned_handover", endEstimated: false });
    // 20:00 UTC on 30 Sep is 1 Oct in Malaysia
    expect(renovationCalendarSpan({ ...base, createdAt: "2026-09-30T20:00:00Z", plannedHandover: "2026-11-20" })?.start).toBe("2026-10-01");
  });
  test("no planned handover: the actual handover, then the SLA due date", () => {
    expect(renovationCalendarSpan({ ...base, handedOverAt: "2026-10-28T09:00:00Z" })).toMatchObject({ end: "2026-10-28", endBasis: "handed_over", endEstimated: false });
    expect(renovationCalendarSpan({ ...base, slaDays: 60 })).toMatchObject({ end: "2026-11-30", endBasis: "sla", endEstimated: false });
  });
  test("nothing to go on: a default length, marked as an estimate", () => {
    expect(RENO_ESTIMATE_DAYS).toBe(45);
    expect(renovationCalendarSpan(base)).toEqual({ start: "2026-10-01", end: "2026-11-15", endBasis: "estimate", endEstimated: true });
    expect(renovationCalendarSpan({ ...base, slaDays: 0 })).toMatchObject({ endBasis: "estimate" });
  });
  test("an end before the start is pulled up to the start; no created date, no bar", () => {
    expect(renovationCalendarSpan({ ...base, plannedHandover: "2026-09-01" })).toMatchObject({ start: "2026-10-01", end: "2026-10-01" });
    expect(renovationCalendarSpan({ ...base, createdAt: null })).toBeNull();
    expect(renovationCalendarSpan({ ...base, createdAt: "not a date" })).toBeNull();
  });
  test("overlap with the visible window", () => {
    const s = { start: "2026-10-01", end: "2026-11-15" };
    expect(spanOverlaps(s, "2026-11-01", "2026-11-30")).toBe(true);
    expect(spanOverlaps(s, "2026-09-01", "2026-09-30")).toBe(false);
    expect(spanOverlaps(s, "2026-11-15", "2026-11-30")).toBe(true);
    expect(spanOverlaps(s, "2026-11-16", "2026-11-30")).toBe(false);
  });
});
