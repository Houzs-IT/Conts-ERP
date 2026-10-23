import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../projects/renovation/renovationTimelineModel";
import type { DesignFile, SiteMeasure, TaskViewV2 } from "../projects/renovation/simpleApi";
import type { BetaDefect, BetaReview, BetaWorkspace } from "./renovationBetaApi";
import {
  dayHeading, dayMonth, dayMonthYear, groupByDay, initials, mytDay, mytTime, nextStep, paymentCard, renovationDays, siteTimeline, stepperItems, trimTimeline,
  approvedSet, defectColumn, defectDaysLate, designDeadlines, designProgress, feedRooms, filterFeed, firstMeasureDate, groupDefects,
  isRecordEntry, paymentStrip, searchEntries, siteFeed, siteProgress, snagProgress, stageReach, timelineCsv, todoList, versionLabel,
  whatsappLink, whatsappNumber, type TodoInput,
} from "./renovationBetaModel";

const TODAY = "2026-10-23";

const file = (id: number, kind: "2d" | "3d" | "other", version: number): DesignFile => ({
  id, kind, version, file_name: `f${id}`, r2_key: null, external_url: null, person_name: null, uploaded_by_name: null,
  uploaded_at: "2026-10-01T00:00:00Z", note: null, submitted_on: null, next_person_id: null, next_person_name: null,
});
const review = (fileId: number, r: Partial<BetaReview> = {}): BetaReview => ({
  fileId, sentOn: null, dueOn: null, approvedOn: null, approvedByName: null, approvalNote: null, ...r,
});
const measure = (id: number, done_on: string | null): SiteMeasure => ({ id, done_on, person_name: null, note: null });
const defect = (id: number, d: Partial<BetaDefect> = {}): BetaDefect => ({
  id, phase: "snag", location: "Kitchen", description: "Cracked tile", trade: null, dueDate: null, reportedAt: "2026-10-10T02:00:00Z",
  reportedByName: null, photoKey: null, afterPhotoKey: null, fixedAt: null, closedAt: null, redoCount: 0, ...d,
});
const workspace = (w: Partial<BetaWorkspace> = {}): BetaWorkspace => ({
  settings: { design3dDays: 10, design2dDays: 12 }, reviews: [], defects: [], payments: { state: "none" }, ...w,
});
const input = (i: Partial<TodoInput> = {}): TodoInput => ({
  today: TODAY, projectName: "Unit 12-3", customerName: "Aisha", customerPhone: "012-345 6789", currentStage: "design",
  files: [], measures: [], workspace: workspace(), ...i,
});

describe("approvedSet", () => {
  it("is empty with no files", () => {
    const s = approvedSet([], [], "3d");
    expect(s).toEqual({ versions: [], approved: null, waiting: null });
  });
  it("takes the newest approved version and shows no waiting one when the newest is approved", () => {
    const files = [file(1, "2d", 1), file(2, "2d", 2)];
    const s = approvedSet(files, [review(1, { approvedOn: "2026-10-02" }), review(2, { approvedOn: "2026-10-05" })], "2d");
    expect(s.approved?.file.id).toBe(2);
    expect(s.waiting).toBeNull();
    expect(s.versions.map((v) => v.file.version)).toEqual([2, 1]);
  });
  it("keeps the older approved set and flags the newer unapproved version as waiting", () => {
    const files = [file(1, "2d", 1), file(2, "2d", 2), file(3, "2d", 3)];
    const s = approvedSet(files, [review(2, { approvedOn: "2026-10-05" }), review(3, { sentOn: "2026-10-20", dueOn: "2026-10-27" })], "2d");
    expect(s.approved?.file.id).toBe(2);
    expect(s.waiting?.file.id).toBe(3);
    expect(s.waiting?.review?.dueOn).toBe("2026-10-27");
  });
  it("treats the first version as waiting when nothing is approved, and ignores other kinds", () => {
    const s = approvedSet([file(1, "3d", 1), file(2, "2d", 1), file(3, "other", 1)], [], "3d");
    expect(s.approved).toBeNull();
    expect(s.waiting?.file.id).toBe(1);
    expect(s.versions).toHaveLength(1);
  });
  it("labels a version", () => {
    expect(versionLabel("2d", file(1, "2d", 3))).toBe("2D v3");
  });
});

describe("design deadlines", () => {
  const settings = { design3dDays: 10, design2dDays: 12 };
  it("uses the first site measure for 3D and the 3D approval for 2D", () => {
    const threeD = approvedSet([file(1, "3d", 1)], [review(1, { approvedOn: "2026-10-20" })], "3d");
    const d = designDeadlines([measure(2, "2026-10-12"), measure(1, "2026-10-05")], threeD, settings);
    expect(d).toEqual({ threeDDue: "2026-10-15", twoDDue: "2026-11-01" });
  });
  it("is null when the start is unknown", () => {
    const d = designDeadlines([measure(1, null)], approvedSet([], [], "3d"), settings);
    expect(d).toEqual({ threeDDue: null, twoDDue: null });
    expect(firstMeasureDate([])).toBeNull();
  });
  it("does not start 2D from a 3D version that is only sent", () => {
    const threeD = approvedSet([file(1, "3d", 1)], [review(1, { sentOn: "2026-10-20" })], "3d");
    expect(designDeadlines([measure(1, "2026-10-01")], threeD, settings).twoDDue).toBeNull();
  });
  it("designProgress reports done, waiting and open with days left", () => {
    const files = [file(1, "3d", 1), file(2, "2d", 1)];
    const ws = workspace({ reviews: [review(1, { approvedOn: "2026-10-20" }), review(2, { sentOn: "2026-10-21" })] });
    const rows = designProgress(files, [measure(1, "2026-10-01")], ws, TODAY);
    expect(rows.map((r) => [r.kind, r.state])).toEqual([["onsite", "done"], ["3d", "done"], ["2d", "waiting"]]);
    expect(rows[2]?.due).toBe("2026-11-01");
    expect(rows[2]?.daysLeft).toBe(9);
    expect(rows[1]?.daysLeft).toBeNull();
    const none = designProgress([], [], workspace(), TODAY);
    expect(none.every((r) => r.state === "open" && r.due === null && r.daysLeft === null)).toBe(true);
  });
});

describe("defects", () => {
  it("sorts a defect into a column", () => {
    expect(defectColumn(defect(1))).toBe("to_fix");
    expect(defectColumn(defect(1, { fixedAt: "2026-10-12T00:00:00Z" }))).toBe("check");
    expect(defectColumn(defect(1, { fixedAt: "2026-10-12T00:00:00Z", closedAt: "2026-10-13T00:00:00Z" }))).toBe("done");
    expect(defectColumn(defect(1, { closedAt: "2026-10-13T00:00:00Z" }))).toBe("done");
  });
  it("counts days late only for a defect still to fix", () => {
    expect(defectDaysLate(defect(1, { dueDate: "2026-10-20" }), TODAY)).toBe(3);
    expect(defectDaysLate(defect(1, { dueDate: "2026-10-23" }), TODAY)).toBe(0);
    expect(defectDaysLate(defect(1, { dueDate: "2026-10-30" }), TODAY)).toBe(0);
    expect(defectDaysLate(defect(1), TODAY)).toBe(0);
    expect(defectDaysLate(defect(1, { dueDate: "2026-10-01", fixedAt: "2026-10-05T00:00:00Z" }), TODAY)).toBe(0);
  });
  it("a redone defect is back in To fix and can be late again", () => {
    const redo = defect(1, { dueDate: "2026-10-21", redoCount: 1, fixedAt: null });
    expect(defectColumn(redo)).toBe("to_fix");
    expect(defectDaysLate(redo, TODAY)).toBe(2);
  });
  it("groups with the earliest fix-by date first and undated last", () => {
    const g = groupDefects([defect(1), defect(2, { dueDate: "2026-10-25" }), defect(3, { dueDate: "2026-10-22" }), defect(4, { fixedAt: "2026-10-12T00:00:00Z" })]);
    expect(g.to_fix.map((d) => d.id)).toEqual([3, 2, 1]);
    expect(g.check.map((d) => d.id)).toEqual([4]);
    expect(g.done).toEqual([]);
    expect(groupDefects([])).toEqual({ to_fix: [], check: [], done: [] });
  });
  it("counts only snags for the handover", () => {
    expect(snagProgress([])).toEqual({ closed: 0, total: 0 });
    expect(snagProgress([defect(1), defect(2, { closedAt: "2026-10-13T00:00:00Z" }), defect(3, { phase: "defect_check" })])).toEqual({ closed: 1, total: 2 });
  });
});

describe("whatsapp", () => {
  it("turns Malaysian numbers into 60...", () => {
    expect(whatsappNumber("012-345 6789")).toBe("60123456789");
    expect(whatsappNumber("0123456789")).toBe("60123456789");
    expect(whatsappNumber("+60 12-345 6789")).toBe("60123456789");
    expect(whatsappNumber("60123456789")).toBe("60123456789");
    expect(whatsappNumber("0060123456789")).toBe("60123456789");
    expect(whatsappNumber("+60 012 345 6789")).toBe("60123456789");
    expect(whatsappNumber("12-3456789")).toBe("60123456789");
    expect(whatsappNumber("03-2345 6789")).toBe("60323456789");
  });
  it("keeps another country code", () => {
    expect(whatsappNumber("+65 9123 4567")).toBe("6591234567");
    expect(whatsappNumber("+1 415 555 0100")).toBe("14155550100");
  });
  it("gives null for nothing usable", () => {
    expect(whatsappNumber(null)).toBeNull();
    expect(whatsappNumber("")).toBeNull();
    expect(whatsappNumber("n/a")).toBeNull();
    expect(whatsappNumber("123")).toBeNull();
  });
  it("builds the link, with or without a number, and encodes the text", () => {
    expect(whatsappLink("012-345 6789", "Hi & bye")).toBe("https://wa.me/60123456789?text=Hi%20%26%20bye");
    expect(whatsappLink(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("payments", () => {
  const ok: BetaWorkspace["payments"] = {
    state: "ok", contractSen: 100000, receivedSen: 30000,
    instalments: [
      { seq: 2, label: "Hardware", amountSen: 50000, paidSen: 0, status: "not_billed", stageCode: "hardware", trigger: "stage" },
      { seq: 1, label: "Deposit", amountSen: 30000, paidSen: 30000, status: "paid", stageCode: null, trigger: "signing" },
    ],
  };
  it("has no strip unless payments are shown", () => {
    expect(paymentStrip({ state: "hidden" })).toBeNull();
    expect(paymentStrip({ state: "none" })).toBeNull();
  });
  it("orders instalments and names the step each unlocks", () => {
    const s = paymentStrip(ok);
    expect(s?.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(s?.rows[1]?.unlocks).toBe("Hardware works");
    expect(s?.rows[0]?.unlocks).toBeNull();
    expect(s?.rows[1]?.statusLabel).toBe("Not billed");
    expect(s?.receivedPct).toBe(30);
  });
  it("copes with a zero contract", () => {
    expect(paymentStrip({ state: "ok", contractSen: 0, receivedSen: 0, instalments: [] })?.receivedPct).toBeNull();
  });
  it("tells reached, next and later steps apart", () => {
    expect(stageReach("hardware", "hardware")).toBe("reached");
    expect(stageReach("design", "hardware")).toBe("reached");
    expect(stageReach("furniture", "hardware")).toBe("next");
    expect(stageReach("handover", "hardware")).toBe("later");
    expect(stageReach(null, "design")).toBe("reached");
    expect(stageReach("mystery", "design")).toBe("reached");
  });
});

describe("todoList", () => {
  it("is empty when nothing needs anyone", () => {
    expect(todoList(input())).toEqual([]);
  });
  it("asks for a reminder on a drawing sent and not approved, late first", () => {
    const files = [file(1, "2d", 1), file(2, "2d", 2)];
    const ws = workspace({ reviews: [review(1, { approvedOn: "2026-10-02" }), review(2, { sentOn: "2026-10-15", dueOn: "2026-10-20" })] });
    const [row] = todoList(input({ files, workspace: ws }));
    expect(row?.tone).toBe("err");
    expect(row?.title).toContain("2D v2");
    expect(row?.detail).toContain("3 days late");
    expect(row?.action.type).toBe("remind");
    if (row?.action.type === "remind") {
      expect(row.action.kind).toBe("client_approval");
      expect(row.action.phone).toBe("012-345 6789");
      expect(row.action.text).toContain("2D v2");
    }
  });
  it("does not nag about a version that was never sent, only its design deadline", () => {
    const files = [file(1, "3d", 1)];
    const rows = todoList(input({ files, measures: [measure(1, "2026-10-15")], workspace: workspace() }));
    expect(rows.map((r) => r.id)).toEqual(["deadline-3d"]);
    expect(rows[0]?.tone).toBe("warn");
    expect(rows[0]?.detail).toBe("2 days left");
    expect(rows[0]?.action).toEqual({ type: "open", label: "Open drawings", tab: "drawings" });
  });
  it("flags a past design deadline and ignores one more than 3 days away or already approved", () => {
    expect(todoList(input({ measures: [measure(1, "2026-10-11")] }))[0]?.title).toBe("3D drawing is 2 days late");
    expect(todoList(input({ measures: [measure(1, "2026-10-20")] }))).toEqual([]);
    const approved = workspace({ reviews: [review(1, { approvedOn: "2026-10-10" })] });
    expect(todoList(input({ files: [file(1, "3d", 1)], measures: [measure(1, "2026-10-01")], workspace: approved })).map((r) => r.id)).toEqual(["deadline-2d"]);
  });
  it("lists the next unpaid instalment once its step is reached or next, never a later one", () => {
    const payments: BetaWorkspace["payments"] = {
      state: "ok", contractSen: 100000, receivedSen: 30000,
      instalments: [
        { seq: 1, label: "Deposit", amountSen: 30000, paidSen: 30000, status: "paid", stageCode: null, trigger: "signing" },
        { seq: 2, label: "Hardware", amountSen: 50000, paidSen: 0, status: "billed", stageCode: "hardware", trigger: "stage" },
        { seq: 3, label: "Handover", amountSen: 20000, paidSen: 0, status: "not_billed", stageCode: "handover", trigger: "stage" },
      ],
    };
    const reached = todoList(input({ currentStage: "hardware", workspace: workspace({ payments }) }));
    expect(reached).toHaveLength(1);
    expect(reached[0]?.title).toContain("Instalment 2");
    expect(reached[0]?.title).toContain("billed, not paid");
    expect(reached[0]?.action).toMatchObject({ type: "remind", kind: "payment", phone: null, label: "Ask Sales" });
    expect(todoList(input({ currentStage: "shop_drawings", workspace: workspace({ payments }) }))[0]?.tone).toBe("muted");
    expect(todoList(input({ currentStage: "design", workspace: workspace({ payments }) }))).toEqual([]);
    expect(todoList(input({ workspace: workspace({ payments: { state: "hidden" } }) }))).toEqual([]);
  });
  it("lists defects past their fix-by date and not the fixed or on-time ones", () => {
    const ws = workspace({ defects: [
      defect(1, { dueDate: "2026-10-20" }), defect(2, { dueDate: "2026-10-30" }),
      defect(3, { dueDate: "2026-10-01", fixedAt: "2026-10-05T00:00:00Z" }), defect(4, { dueDate: "2026-10-01", closedAt: "2026-10-05T00:00:00Z" }),
    ] });
    const rows = todoList(input({ workspace: ws }));
    expect(rows.map((r) => r.id)).toEqual(["defect-1"]);
    expect(rows[0]?.title).toBe("Defect at Kitchen is 3 days late");
  });
  it("puts late items before the rest", () => {
    const ws = workspace({
      reviews: [review(1, { sentOn: "2026-10-22", dueOn: "2026-10-30" })],
      defects: [defect(9, { dueDate: "2026-10-22" })],
    });
    expect(todoList(input({ files: [file(1, "3d", 1)], workspace: ws })).map((r) => r.id)).toEqual(["defect-9", "approval-1"]);
  });
});

describe("site progress", () => {
  const task = (id: number, status: TaskViewV2["status"], planned_start: string | null = null): TaskViewV2 =>
    ({ id, status, planned_start, label: `t${id}` }) as TaskViewV2;
  it("handles no tasks", () => {
    expect(siteProgress([])).toEqual({ total: 0, done: 0, pct: 0, late: 0, open: [] });
  });
  it("leaves skipped tasks out and lists late ones first", () => {
    const p = siteProgress([task(1, "done"), task(2, "skipped"), task(3, "planned", "2026-11-01"), task(4, "overdue"), task(5, "in_progress")]);
    expect(p).toMatchObject({ total: 4, done: 1, pct: 25, late: 1 });
    expect(p.open.map((t) => t.id)).toEqual([4, 5, 3]);
  });
});

describe("timeline", () => {
  const e = (id: string, o: Partial<TimelineEntry> = {}): TimelineEntry => ({
    id, at: "2026-10-20T04:30:00Z", dateOnly: false, category: "system", title: null, body: null, by: null, ...o,
  });
  it("tags approvals, key passes and the handover as records", () => {
    expect(isRecordEntry(e("a", { title: "Drawing 2D v3 approved" }))).toBe(true);
    expect(isRecordEntry(e("a", { title: "Key passed: Ali to Bala" }))).toBe(true);
    expect(isRecordEntry(e("a", { title: "Handover signed" }))).toBe(true);
    expect(isRecordEntry(e("a", { title: "Handed over" }))).toBe(true);
    expect(isRecordEntry(e("a", { title: "Key pass edited" }))).toBe(false);
    expect(isRecordEntry(e("a", { title: "Drawing approval removed" }))).toBe(false);
    expect(isRecordEntry(e("a"))).toBe(false);
  });
  it("searches every word across title, text, who and type", () => {
    const list = [e("1", { title: "Site task done", body: "Plastering", by: "Mei" }), e("2", { category: "customer", body: "Wants a later date" }), e("3", { title: "Handover signed" })];
    expect(searchEntries(list, "").map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(searchEntries(list, "  ").map((x) => x.id)).toEqual(["1", "2", "3"]);
    expect(searchEntries(list, "plaster mei").map((x) => x.id)).toEqual(["1"]);
    expect(searchEntries(list, "CUSTOMER later").map((x) => x.id)).toEqual(["2"]);
    expect(searchEntries(list, "record").map((x) => x.id)).toEqual(["3"]);
    expect(searchEntries(list, "nothing here")).toEqual([]);
    expect(searchEntries([], "x")).toEqual([]);
  });
  it("writes a CSV with only a header for no entries", () => {
    expect(timelineCsv([])).toBe("Date,Type,Record,Title,Details,By");
  });
  it("quotes commas, quotes and line breaks, and shows Malaysia time", () => {
    const csv = timelineCsv([
      e("1", { title: "Quoted, finally", body: 'He said "yes"\nand paid', by: "Mei" }),
      e("2", { at: "2026-10-21", dateOnly: true, category: "site", title: "Plain" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Date,Type,Record,Title,Details,By");
    expect(csv).toContain('2026-10-20 12:30,System,,"Quoted, finally","He said ""yes""\nand paid",Mei');
    expect(csv).toContain("2026-10-21,Site,,Plain,,");
  });
  it("marks records and keeps a formula-looking cell from running in Excel", () => {
    const csv = timelineCsv([e("1", { title: "Handover signed" }), e("2", { title: "=1+1" })]);
    expect(csv).toContain(",RECORD,Handover signed");
    expect(csv).toContain(",'=1+1,");
  });
});

describe("site feed", () => {
  const rooms = [{ room: "Kitchen", photos: [{ id: "p1", r2_key: "renovation/1/a.jpg", location: "Kitchen", caption: null, grn_number: "GRN-1", taken_at: "2026-10-18T01:00:00Z" }, { id: "p2", r2_key: "renovation/1/b.jpg", location: null }] }];
  const measures: SiteMeasure[] = [{ id: 1, done_on: "2026-10-19", person_name: null, note: null, files: [{ id: 5, file_name: "plan.pdf", r2_key: "renovation/1/plan.pdf", content_type: "application/pdf" }] }];
  const defects = [defect(1, { photoKey: "renovation/1/d1.jpg", afterPhotoKey: "renovation/1/d1b.jpg", reportedAt: "2026-10-10T02:00:00Z", fixedAt: "2026-10-21T02:00:00Z" })];
  it("is empty with nothing", () => {
    expect(siteFeed({ rooms: [], measures: [], defects: [] })).toEqual([]);
  });
  it("lists newest first with undated photos last", () => {
    const feed = siteFeed({ rooms, measures, defects });
    expect(feed.map((i) => i.id)).toEqual(["defect-1-after", "onsite-5", "receipt-p1", "defect-1-before", "receipt-p2"]);
    expect(feed.find((i) => i.id === "onsite-5")?.image).toBe(false);
    expect(feed[0]?.caption).toBe("After: Cracked tile");
  });
  it("filters by room, including photos with no room", () => {
    const feed = siteFeed({ rooms, measures, defects });
    expect(feedRooms(feed)).toEqual(["Kitchen"]);
    expect(filterFeed(feed, "Kitchen").map((i) => i.id)).toEqual(["defect-1-after", "receipt-p1", "defect-1-before"]);
    expect(filterFeed(feed, "No room").map((i) => i.id)).toEqual(["onsite-5", "receipt-p2"]);
    expect(filterFeed(feed, "")).toHaveLength(5);
  });
});

describe("dates as the mockup prints them", () => {
  it("prints day and month, with the year only where asked", () => {
    expect(dayMonth("2026-10-14")).toBe("14 Oct");
    expect(dayMonth("2026-10-14T05:00:00Z")).toBe("14 Oct");
    expect(dayMonth(null)).toBe("-");
    expect(dayMonthYear("2026-11-15")).toBe("15 Nov 2026");
    expect(dayHeading("2026-10-20", TODAY)).toBe("20 Oct");
    expect(dayHeading("2025-12-30", TODAY)).toBe("30 Dec 2025");
  });
  it("reads a stored time as Malaysia time", () => {
    expect(mytDay("2026-10-20T17:30:00Z")).toBe("2026-10-21");
    expect(mytTime("2026-10-20T17:30:00Z")).toBe("01:30");
    expect(mytDay("2026-10-20")).toBe("2026-10-20");
    expect(mytTime("2026-10-20")).toBeNull();
  });
  it("groups by day in first-seen order with undated items last", () => {
    const g = groupByDay([{ d: "b", n: 1 }, { d: null, n: 2 }, { d: "a", n: 3 }, { d: "b", n: 4 }], (x) => x.d);
    expect(g.map((x) => [x.day, x.items.map((i) => i.n)])).toEqual([["b", [1, 4]], ["a", [3]], [null, [2]]]);
    expect(groupByDay([], () => null)).toEqual([]);
  });
  it("makes initials", () => {
    expect([initials("Jia Xin"), initials("Alex"), initials("  "), initials(null), initials("Ahmad bin Ali")]).toEqual(["JX", "A", "?", "?", "AA"]);
  });
});

describe("paymentCard", () => {
  const row = (status: "paid" | "billed" | "not_billed", stageCode: string | null) => ({ status, stageCode, unlocks: stageCode ? "Design" : null });
  it("paid is green and names what it unlocked", () => {
    expect(paymentCard(row("paid", "design"), "design", null)).toEqual({ look: "paid", badge: "Paid", note: "Paid · unlocked Design" });
  });
  it("an unpaid instalment whose step is reached is the red card", () => {
    expect(paymentCard(row("billed", "design"), "design", null)).toMatchObject({ look: "alert", badge: "Not confirmed", note: "Needed before Design" });
  });
  it("a later step is the grey card, and the handover one says so", () => {
    expect(paymentCard({ status: "not_billed", stageCode: "handover", unlocks: "Cleaning & handover" }, "design", "2026-11-15")).toEqual({
      look: "quiet", badge: "At handover", note: "Unlocks Cleaning & handover · 15 Nov",
    });
    expect(paymentCard({ status: "not_billed", stageCode: "hardware", unlocks: "Hardware works" }, "design", null).badge).toBe("Not due yet");
  });
  it("an instalment without a step is red only when it is billed", () => {
    expect(paymentCard(row("billed", null), "design", null).look).toBe("alert");
    expect(paymentCard(row("not_billed", null), "design", null)).toMatchObject({ look: "quiet", badge: "Not billed" });
  });
});

describe("nextStep", () => {
  const r = (id: string): ReturnType<typeof todoList>[number] => ({ id, tone: "err", group: "g", title: id, detail: null, action: { type: "open", label: "x", tab: "drawings" } });
  it("takes the design waiting for the client, else the first row", () => {
    expect(nextStep([r("defect-1"), r("approval-3")])).toMatchObject({ next: { id: "approval-3" }, rest: [{ id: "defect-1" }] });
    expect(nextStep([r("defect-1"), r("payment-2")]).next?.id).toBe("defect-1");
    expect(nextStep([])).toEqual({ next: null, rest: [] });
  });
});

describe("site timeline", () => {
  const task = (id: number, status: TaskViewV2["status"], d: Partial<TaskViewV2> = {}): TaskViewV2 =>
    ({ id, seq: id, status, label: `t${id}`, planned_start: null, planned_end: null, actual_start: null, actual_end: null, ...d }) as TaskViewV2;
  const tasks = [
    task(1, "done", { planned_start: "2026-10-12", planned_end: "2026-10-14", actual_end: "2026-10-15" }),
    task(2, "in_progress", { planned_start: "2026-10-20", planned_end: "2026-10-25", actual_start: "2026-10-20" }),
    task(3, "planned", { planned_start: "2026-10-30", planned_end: "2026-11-05" }),
    task(4, "overdue", { planned_start: "2026-10-18", planned_end: "2026-10-21" }),
    task(5, "skipped", { planned_start: "2026-10-01" }),
  ];
  it("counts the day of the renovation from the dates of the live tasks", () => {
    expect(renovationDays(tasks, TODAY)).toEqual({ day: 12, total: 25, start: "2026-10-12" });
    expect(renovationDays(tasks, "2026-10-01")).toMatchObject({ day: 0 });
    expect(renovationDays(tasks, "2027-01-01")).toMatchObject({ day: 25, total: 25 });
    expect(renovationDays([task(1, "planned")], TODAY)).toBeNull();
    expect(renovationDays([], TODAY)).toBeNull();
  });
  it("lists live tasks by date, marks today and the late one, then the handover", () => {
    const t = siteTimeline(tasks, TODAY, "2026-11-15T00:00:00Z");
    expect(t.map((s) => [s.id, s.state, s.date])).toEqual([
      ["task-1", "done", "2026-10-15"], ["task-4", "late", "2026-10-21"], ["task-2", "current", TODAY], ["task-3", "later", "2026-10-30"], ["handover", "handover", "2026-11-15"],
    ]);
    expect(t[1]?.sub).toBe("2 days late");
    expect(t[2]?.sub).toBe("In progress");
    expect(siteTimeline([], TODAY, null)).toEqual([]);
  });
  it("keeps the last finished steps and the next few ahead until asked for all", () => {
    const many = [...Array.from({ length: 6 }, (_, i) => task(i + 1, "done", { actual_end: `2026-10-0${i + 1}` })), ...Array.from({ length: 10 }, (_, i) => task(i + 10, "planned", { planned_start: `2026-11-${10 + i}` }))];
    const steps = siteTimeline(many, TODAY, "2026-12-01");
    const t = trimTimeline(steps, false);
    expect(t).toMatchObject({ hiddenDone: 3, hiddenLater: 2 });
    expect(t.steps.at(-1)?.id).toBe("handover");
    expect(trimTimeline(steps, true)).toMatchObject({ hiddenDone: 0, hiddenLater: 0 });
  });
});

describe("stepperItems", () => {
  const steps = [{ key: "design", label: "Design" }, { key: "signed", label: "Signed" }, { key: "ordering", label: "Ordering" }, { key: "renovation", label: "Renovation" }, { key: "handover", label: "Handover" }, { key: "closed", label: "Closed" }];
  const tasks = [{ status: "in_progress", planned_start: "2026-10-12", planned_end: "2026-11-05", actual_start: null, actual_end: null }] as unknown as TaskViewV2[];
  it("follows the flow order and words each step as the mockup does", () => {
    const items = stepperItems({ steps, currentIndex: 3, soDate: "2026-08-10", handoverOn: "2026-11-15", tasks, today: TODAY });
    expect(items.map((i) => [i.label, i.state, i.sub])).toEqual([
      ["Design", "done", "Design approved"], ["Sales order", "done", "Signed 10 Aug"], ["Ordering", "done", "Main items ordered"],
      ["Renovation", "current", "Day 12 of 25"], ["Handover", "later", "15 Nov"], ["Closed", "later", "-"],
    ]);
  });
  it("says in progress when the site tasks have no dates", () => {
    const items = stepperItems({ steps, currentIndex: 3, soDate: null, handoverOn: null, tasks: [], today: TODAY });
    expect(items[3]?.sub).toBe("In progress");
    expect(items[1]?.sub).toBe("-");
  });
});
