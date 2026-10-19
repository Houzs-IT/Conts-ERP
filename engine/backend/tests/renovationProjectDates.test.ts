import { describe, expect, test } from "vitest";
import { dayOf, projectDatesFor, syncProjectDates, type ProjectDatesInput } from "../src/services/renovation/projectDates";
import { renovationCalendarSpan } from "../src/services/renovation/calendarSpan";
import type { Db, ProjectFacts } from "../src/services/renovation/load";

const open: ProjectDatesInput = {
  current: "design", manualInEffect: false, manualAt: null, closedAt: null,
  createdAt: "2026-10-01T03:00:00Z", startDate: null, endDate: null, today: "2026-10-15",
};

describe("Start date and End date of a renovation project fill themselves (owner, 15 Oct 2026)", () => {
  test("create sets the start: the created day in Malaysia time", () => {
    expect(projectDatesFor(open)).toEqual({ startDate: "2026-10-01", endDate: null });
    // 20:00 UTC on 30 Sep is 1 Oct in Malaysia
    expect(projectDatesFor({ ...open, createdAt: "2026-09-30T20:00:00Z" }).startDate).toBe("2026-10-01");
    // a start the insert trigger already stored is kept
    expect(projectDatesFor({ ...open, startDate: "2026-09-28" }).startDate).toBe("2026-09-28");
  });

  test("moving to Closed by hand sets the end to the day it was moved", () => {
    expect(projectDatesFor({ ...open, current: "closed", manualInEffect: true, manualAt: "2026-10-14T18:30:00Z" }))
      .toEqual({ startDate: "2026-10-01", endDate: "2026-10-15" });
  });

  test("Closed by the data: the closed_at day, else the day it is first seen Closed", () => {
    expect(projectDatesFor({ ...open, current: "closed", closedAt: "2026-10-10T02:00:00Z" }).endDate).toBe("2026-10-10");
    expect(projectDatesFor({ ...open, current: "closed" }).endDate).toBe("2026-10-15");
  });

  test("an end already stored is kept while it stays Closed (a later read does not move it)", () => {
    expect(projectDatesFor({ ...open, current: "closed", manualInEffect: true, manualAt: "2026-10-15T01:00:00Z", endDate: "2026-10-12" }).endDate)
      .toBe("2026-10-12");
  });

  test("moving back out of Closed clears the end", () => {
    for (const step of ["design", "signed", "ordering", "renovation", "handover"] as const) {
      expect(projectDatesFor({ ...open, current: step, endDate: "2026-10-12" }).endDate).toBeNull();
    }
  });

  test("dayOf reads text dates, timestamps and Date objects as the Malaysian day", () => {
    expect(dayOf("2026-10-01")).toBe("2026-10-01");
    expect(dayOf("2026-10-01T17:00:00Z")).toBe("2026-10-02");
    expect(dayOf(new Date("2026-10-01T15:59:00Z"))).toBe("2026-10-01");
    expect(dayOf("")).toBeNull();
    expect(dayOf(null)).toBeNull();
    expect(dayOf("not a date")).toBeNull();
  });
});

describe("syncProjectDates writes only when the stored dates differ", () => {
  function fakeDb() {
    const writes: unknown[][] = [];
    const db: Db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => { writes.push([sql, ...args]); return {}; },
          first: async () => null,
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as Db;
    return { db, writes };
  }
  const facts = (over: Partial<ProjectFacts["project"]>) => ({ project: { id: 7, created_at: "2026-10-01T03:00:00Z", closed_at: null, start_date: "2026-10-01", end_date: null, ...over } }) as unknown as ProjectFacts;
  const flow = (current: ProjectDatesInput["current"], manualInEffect = false) => ({ flow: { current, manualInEffect } }) as never;

  test("nothing to write when they already match", async () => {
    const { db, writes } = fakeDb();
    await syncProjectDates(db, facts({}), flow("renovation"), "2026-10-15");
    expect(writes).toHaveLength(0);
  });

  test("reaching Closed writes the end; leaving it writes it empty", async () => {
    const { db, writes } = fakeDb();
    const f = facts({ flow_manual_at: "2026-10-15T02:00:00Z" });
    expect(await syncProjectDates(db, f, flow("closed", true), "2026-10-15")).toEqual({ startDate: "2026-10-01", endDate: "2026-10-15" });
    expect(writes[0]!.slice(1)).toEqual(["2026-10-01", "2026-10-15", 7]);
    expect(f.project.end_date).toBe("2026-10-15");
    await syncProjectDates(db, f, flow("handover"), "2026-10-16");
    expect(writes[1]!.slice(1)).toEqual(["2026-10-01", null, 7]);
  });

  test("a failed write never fails the read", async () => {
    const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("down"); } }) }) } as unknown as Db;
    const err = console.error;
    console.error = () => {};
    try {
      expect(await syncProjectDates(db, facts({}), flow("closed"), "2026-10-15")).toEqual({ startDate: "2026-10-01", endDate: null });
    } finally {
      console.error = err;
    }
  });
});

describe("calendar bar follows the stored dates", () => {
  const base = { createdAt: "2026-10-01T03:00:00Z", plannedHandover: "2026-11-20", handedOverAt: null, slaDays: null };
  test("starts on the Start date, ends on the End date once Closed", () => {
    expect(renovationCalendarSpan({ ...base, startDate: "2026-10-01", endDate: "2026-11-05" }))
      .toEqual({ start: "2026-10-01", end: "2026-11-05", endBasis: "completed", endEstimated: false });
  });
  test("not Closed: the planned handover as before", () => {
    expect(renovationCalendarSpan({ ...base, startDate: "2026-10-01", endDate: null })).toMatchObject({ end: "2026-11-20", endBasis: "planned_handover" });
  });
});
