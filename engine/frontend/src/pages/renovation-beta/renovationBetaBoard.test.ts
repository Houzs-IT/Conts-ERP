import { describe, expect, it } from "vitest";
import type { BetaBoard, BetaBoardProject } from "./renovationBetaBoardApi";
import {
  add, amendDue, bookIssue, buildModel, conditionText, deadlineGroups, diff, ds, homeCounts, homeList, homeRow, initials, items,
  listFor, monthCells, nextFor, progressList, rangeFor, shiftMonth, stage, status, type BoardModel, type DesignProject,
} from "./renovationBetaBoard";

const TODAY = "2026-10-23";
const JX = { id: 1, name: "Jia Xin" };
const YT = { id: 2, name: "Ying Tzy" };
const YX = { id: 3, name: "Yi Xuan" };
const AL = { id: 4, name: "Alex" };

let nextId = 100;
const id = (): number => nextId++;

function project(over: Partial<BetaBoardProject> & { id: number; building: string; unitNo: string; customerName: string }): BetaBoardProject {
  return {
    code: null, name: `${over.building} ${over.unitNo}`, salesName: null, createdOn: null, handoverOn: null,
    lead: JX, person3d: null, person2d: null, sitePic: AL, measuredOn: "2026-09-01",
    start3dOn: null, start2dOn: null, poDoneOn: null, files: [], notes: [], reviews: [], appointments: [], payment: { state: "ok", label: "1st payment" },
    ...over,
  };
}

const file = (kind: "3d" | "2d", version: number, submittedOn: string): { id: number; kind: "3d" | "2d"; version: number; submittedOn: string } => ({
  id: id(), kind, version, submittedOn,
});

function approved(f: { id: number }, on: string): { fileId: number; sentOn: string | null; approvedOn: string | null } {
  return { fileId: f.id, sentOn: null, approvedOn: on };
}

function board(projects: BetaBoardProject[]): BetaBoard {
  return {
    today: TODAY, mePersonId: 1, settings: { design3dDays: 10, design2dDays: 12, amendmentDays: 3 },
    people: [JX, YT, YX, AL].map((p) => ({ ...p, roles: [] })), projects, events: [],
  };
}

/* Rows rebuilt from the mockup's sample projects. */
/* The server closes only 2D notes, so the 3D rounds here are answered by later versions, never by closedOn. */
const f4 = file("3d", 1, "2026-10-08");
const f4b = file("3d", 2, "2026-10-16");
const baron = project({
  id: 4, building: "Baron", unitNo: "C-20-08", customerName: "Mr Albert", start3dOn: "2026-09-28", files: [f4, f4b], reviews: [approved(f4, "2026-10-09")],
  notes: [
    { id: 41, kind: "3d", notedOn: "2026-10-13", closedOn: null, days: null },
    { id: 42, kind: "3d", notedOn: "2026-10-20", closedOn: null, days: null },
  ],
});
const f5a = file("3d", 1, "2026-09-24");
const f5b = file("2d", 1, "2026-10-09");
const trinity = project({
  id: 5, building: "Trinity Wellnessa", unitNo: "A2-15-03A", customerName: "Mr Teoh", lead: YT, start3dOn: "2026-09-14", start2dOn: "2026-09-28",
  files: [f5a, f5b], reviews: [approved(f5a, "2026-09-26"), approved(f5b, "2026-10-12")], poDoneOn: "2026-10-12", handoverOn: "2026-11-27",
  appointments: [{ kind: "carpentry_measure", onDate: "2026-10-24", atTime: "10:00:00", personId: 2, withText: "Ah Seng (carpenter)", doneAt: null }],
});
const f11a = file("3d", 1, "2026-08-20");
const f11b = file("2d", 1, "2026-09-05");
const lakeville = project({
  id: 11, building: "Lakeville", unitNo: "C-15-07", customerName: "Ms Wong", start3dOn: "2026-08-10", start2dOn: "2026-08-24",
  files: [f11a, f11b], reviews: [approved(f11a, "2026-08-22"), approved(f11b, "2026-09-07")], poDoneOn: "2026-09-15", handoverOn: "2026-11-20",
  appointments: [
    { kind: "carpentry_measure", onDate: "2026-10-14", atTime: "10:00:00", personId: 1, withText: "Ah Seng (carpenter)", doneAt: "2026-10-14T03:00:00Z" },
    { kind: "site_briefing", onDate: "2026-10-26", atTime: "10:30:00", personId: 1, withText: "Alex", doneAt: null },
  ],
});
const fresh = project({ id: 13, building: "Bukit Jalil The Park 2", unitNo: "", customerName: "Ms Tan", lead: null, sitePic: null, measuredOn: null });
const f6 = file("3d", 1, "2026-10-20");
const aster = project({ id: 6, building: "Aster Hill", unitNo: "B-01-06", customerName: "Mr Aiden", lead: YT, start3dOn: "2026-10-10", files: [f6] });
const f1a = file("3d", 1, "2026-10-08");
const legacy = project({
  id: 1, building: "Legacy OUG", unitNo: "A26-03", customerName: "Mr Wayne", start3dOn: "2026-09-28", start2dOn: "2026-10-12", person2d: YX,
  files: [f1a], reviews: [approved(f1a, "2026-10-10")],
});
const f10 = file("3d", 1, "2026-09-03");
const riana = project({ id: 10, building: "Seri Riana", unitNo: "C-12-03", customerName: "Ms Lim", start3dOn: "2026-08-24", files: [f10], reviews: [approved(f10, "2026-09-05")] });

const m: BoardModel = buildModel(board([baron, trinity, lakeville, fresh, aster, legacy, riana]));
const get = (pid: number): DesignProject => {
  const p = m.byId.get(pid);
  if (!p) throw new Error(`no project ${pid}`);
  return p;
};

describe("dates", () => {
  it("adds and counts days without a time zone", () => {
    expect(add("2026-10-30", 3)).toBe("2026-11-02");
    expect(diff("2026-10-24", TODAY)).toBe(1);
    expect(ds("2026-10-23")).toBe("23 Oct");
  });
  it("makes badge letters", () => {
    expect(initials("Jia Xin")).toBe("JX");
    expect(initials("Alex")).toBe("AL");
  });
});

describe("status words", () => {
  it("follows the mockup for each condition", () => {
    expect(conditionText(m, get(4))).toBe("B - 3D amendment");
    expect(conditionText(m, get(5))).toBe("D - Carpentry measure booked");
    expect(conditionText(m, get(11))).toBe("D - Site briefing booked");
    expect(conditionText(m, get(13))).toBe("A - New · team not assigned");
    expect(conditionText(m, get(6))).toBe("B - 3D sent · waiting client");
    expect(conditionText(m, get(1))).toBe("C - 2D in progress");
  });
  it("says Done all design when every step is done", () => {
    const done = buildModel(board([{ ...lakeville, appointments: lakeville.appointments.map((a) => ({ ...a, doneAt: "2026-10-26T01:00:00Z" })) }]));
    expect(status(done, done.projects[0])[0]).toBe("E");
  });
  it("re-opens the stage when an amendment is open after approval", () => {
    expect(stage(m, get(4), "3").st).toBe("work");
    expect(m.byId.get(4)?.design["3"].am.map((a) => a.done)).toEqual(["2026-10-16", null]);
  });
  it("answers a 3D amendment with the next version, then needs that version approved", () => {
    const v1 = file("3d", 1, "2026-10-08");
    const v2 = file("3d", 2, "2026-10-16");
    const note = { id: 91, kind: "3d" as const, notedOn: "2026-10-13", closedOn: null, days: null };
    const sent = buildModel(board([project({ id: 9, building: "Aster", unitNo: "A1", customerName: "X", start3dOn: "2026-09-28", files: [v1, v2], notes: [note], reviews: [approved(v1, "2026-10-10")] })]));
    expect(stage(sent, sent.projects[0], "3").st).toBe("wait");
    expect(status(sent, sent.projects[0])[1]).toBe("3D sent · waiting client");
    const ok = buildModel(board([project({ id: 9, building: "Aster", unitNo: "A1", customerName: "X", start3dOn: "2026-09-28", files: [v1, v2], notes: [note], reviews: [approved(v1, "2026-10-10"), approved(v2, "2026-10-18")] })]));
    expect(stage(ok, ok.projects[0], "3").st).toBe("ok");
    const open = buildModel(board([project({ id: 9, building: "Aster", unitNo: "A1", customerName: "X", start3dOn: "2026-09-28", files: [v1], notes: [note], reviews: [approved(v1, "2026-10-10")] })]));
    expect(stage(open, open.projects[0], "3").st).toBe("work");
  });
  it("counts the first 3D file as the stage start when no start date is saved", () => {
    const g = buildModel(board([{ ...aster, start3dOn: null, measuredOn: "2026-10-05" }]));
    expect(g.projects[0].design["3"].s).toBe("2026-10-05");
    expect(g.projects[0].design["3"].done).toBe("2026-10-20");
  });
});

describe("next step and Home", () => {
  it("finds the next deadline", () => {
    expect(nextFor(m, get(4))).toMatchObject({ t: "3D 2nd amendment due", d: "2026-10-23" });
    expect(nextFor(m, get(5))).toMatchObject({ t: "Carpentry measure", d: "2026-10-24" });
    expect(nextFor(m, get(11))).toMatchObject({ t: "Site briefing", d: "2026-10-26" });
    expect(nextFor(m, get(6))).toMatchObject({ t: "3D waiting for client", d: null });
    expect(nextFor(m, get(1))).toMatchObject({ t: "2D due", d: "2026-10-24" });
  });
  it("counts the tabs and sorts unassigned first, soonest next", () => {
    const c = homeCounts(m);
    expect(c.tabs).toEqual({ all: 7, A: 1, BC: 4, D: 2, E: 0 });
    expect(c.late).toBe(0);
    expect(c.week).toBe(4);
    expect(homeList(m, "all").map((p) => p.id)).toEqual([13, 4, 5, 1, 11, 6, 10]);
  });
  it("says who to ask on the row", () => {
    expect(homeRow(m, get(13), true).whoNow).toEqual({ kind: "assign" });
    expect(homeRow(m, get(13), false).whoNow).toEqual({ kind: "needs" });
    expect(homeRow(m, get(1), true).whoNow).toEqual({ kind: "name", name: "Yi Xuan" });
  });
  it("uses the building as the tag", () => {
    expect(get(13).tag).toBe("Bukit Jalil The Park 2");
    expect(get(13).name).toBe("Bukit Jalil The Park 2 · Ms Tan");
  });
});

describe("deadline groups", () => {
  it("groups by days left and keeps the waiting, ready and to-do lists", () => {
    const g = deadlineGroups(m, "All", true);
    expect(g.late).toHaveLength(0);
    expect(g.week.map((x) => `${x.p.id}:${x.type === "appt" ? x.ak : x.k}`)).toEqual(["4:3", "1:2", "5:cm", "11:sb"]);
    expect(g.two).toHaveLength(0);
    expect(g.later.map((x) => x.p.id)).toEqual([11, 5]);
    expect(g.waiting.map((x) => `${x.p.id}:${x.k}`)).toEqual(["6:3"]);
    expect(g.ready.map((x) => `${x.p.id}:${x.k}`)).toEqual(["10:2"]);
    expect(g.todo.map((x) => `${x.p.id}:${x.k}`)).toEqual(["5:sb", "13:as"]);
  });
  it("shows only the chosen person's work", () => {
    const g = deadlineGroups(m, 2, false);
    expect(g.week.map((x) => x.p.id)).toEqual([5]);
    expect(g.waiting.map((x) => x.p.id)).toEqual([6]);
    expect(g.todo.map((x) => `${x.p.id}:${x.k}`)).toEqual(["5:sb"]);
    expect(items(m, 3).map((x) => x.p.id)).toEqual([1]);
  });
  it("asks for PO and bookings once 2D is approved", () => {
    const g = deadlineGroups(buildModel(board([{ ...trinity, poDoneOn: null, appointments: [] }])), "All", false);
    expect(g.todo.map((x) => x.k)).toEqual(["cm", "po"]);
  });
});

describe("progress and calendar", () => {
  it("lists a person's projects, furthest behind first", () => {
    expect(progressList(m, 2).map((p) => p.id)).toEqual([6, 5]);
  });
  it("lists what is coming up and what is on a picked day", () => {
    const up = listFor(m, "All", null);
    expect(up.title).toBe("Coming up");
    expect(up.events.map((e) => e.id)).toEqual(["ap|5|cm", "ap|11|sb"]);
    const day = listFor(m, "All", "2026-10-23");
    expect(day.title).toBe("23 Oct · today");
    expect(day.due.map((x) => x.p.id)).toEqual([4]);
  });
  it("builds the month grid Monday first", () => {
    const cells = monthCells(2026, 9);
    expect(cells.filter((c) => c === null)).toHaveLength(4);
    expect(cells.findIndex((c) => c === 1)).toBe(3);
    expect(cells).toHaveLength(35);
  });
  it("pages months across the year and widens the board window only when needed", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ y: 2027, m: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ y: 2025, m: 11 });
    expect(rangeFor(TODAY, 2026, 9)).toBeUndefined();
    expect(rangeFor(TODAY, 2027, 7)).toEqual({ from: "2026-08-24", to: "2027-08-31" });
    expect(rangeFor(TODAY, 2027, 8)).toEqual({ from: "2027-09-01", to: "2027-09-30" });
  });
});

describe("form checks", () => {
  it("adds the days to an amendment start", () => {
    expect(amendDue("2026-10-23", 3)).toBe("2026-10-26");
  });
  it("keeps the site briefing after the carpentry measure", () => {
    expect(bookIssue(get(11), "sb", "2026-10-14")).toBe("Site briefing must be after the carpentry measure (14 Oct)");
    expect(bookIssue(get(11), "sb", "2026-10-15")).toBeNull();
    expect(bookIssue(get(11), "cm", "2026-10-01")).toBeNull();
  });
});
