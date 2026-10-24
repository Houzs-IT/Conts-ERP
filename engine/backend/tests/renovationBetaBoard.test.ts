import { describe, expect, test } from "vitest";
import {
  addDays, buildBoardProject, cleanBetaAppointment, cleanBetaDesign, cleanBetaEvent, cleanBetaEventPatch, cleanBoardRange, cleanNoteDays, createdOnOf,
  designChangeNote, designPersonIds, groupByProject, isClockTime, ordinal, paymentLabel, rolesOf, type BoardProjectRow,
} from "../src/services/renovation/betaBoard";
import type { BetaInstalment, BetaPayments } from "../src/services/renovation/beta";
import { activityText } from "../src/services/renovation/timeline";

const inst = (seq: number, status: BetaInstalment["status"]): BetaInstalment => ({
  seq, label: `Instalment ${seq}`, amountSen: 1000, paidSen: status === "paid" ? 1000 : 0, status, stageCode: null, trigger: "manual",
});
const ok = (...i: BetaInstalment[]): BetaPayments => ({ state: "ok", contractSen: 10000, receivedSen: 0, instalments: i });

describe("Beta board: payment label", () => {
  test("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
  test("paid out of all, or the bill waiting for money", () => {
    expect(paymentLabel(ok(inst(1, "paid"), inst(2, "billed"), inst(3, "not_billed")))).toMatchObject({ state: "ok", label: "Pending 2nd payment" });
    expect(paymentLabel(ok(inst(1, "paid"), inst(2, "not_billed"), inst(3, "not_billed")))).toMatchObject({ state: "ok", label: "1 of 3 paid" });
    expect(paymentLabel(ok(inst(1, "billed"), inst(2, "not_billed")))).toMatchObject({ state: "ok", label: "Pending 1st payment" });
    expect(paymentLabel(ok(inst(1, "paid"), inst(2, "paid"), inst(3, "paid"), inst(4, "not_billed")))).toMatchObject({ state: "ok", label: "3 of 4 paid" });
  });
  test("outstanding is the order total less what was received, never below zero", () => {
    expect(paymentLabel({ state: "ok", contractSen: 10000, receivedSen: 2500, instalments: [inst(1, "paid"), inst(2, "not_billed")] })).toEqual({ state: "ok", label: "1 of 2 paid", outstandingSen: 7500 });
    expect(paymentLabel({ state: "ok", contractSen: 10000, receivedSen: 12000, instalments: [inst(1, "paid")] })).toEqual({ state: "ok", label: "Fully paid", outstandingSen: 0 });
  });
  test("all paid reads Fully paid", () => {
    expect(paymentLabel(ok(inst(1, "paid"), inst(2, "paid")))).toMatchObject({ state: "ok", label: "Fully paid" });
  });
  test("hidden and none pass through; a contract with no instalments is none", () => {
    expect(paymentLabel({ state: "hidden" })).toEqual({ state: "hidden" });
    expect(paymentLabel({ state: "none" })).toEqual({ state: "none" });
    expect(paymentLabel(ok())).toEqual({ state: "none" });
  });
});

describe("Beta board: range", () => {
  test("default is today - 60 to today + 180", () => {
    expect(cleanBoardRange(undefined, undefined, "2026-10-23")).toEqual({ ok: true, value: { from: "2026-08-24", to: "2027-04-21" } });
  });
  test("400 days is allowed, 401 is not, backwards and bad dates are refused", () => {
    expect(cleanBoardRange("2026-01-01", "2027-02-04", "2026-10-23")).toMatchObject({ ok: true });
    expect(cleanBoardRange("2026-01-01", "2027-02-05", "2026-10-23")).toMatchObject({ ok: false, error: "range_too_long" });
    expect(cleanBoardRange("2026-02-02", "2026-02-01", "2026-10-23")).toMatchObject({ ok: false, error: "range_invalid" });
    expect(cleanBoardRange("2026-02-31", "2026-03-01", "2026-10-23")).toMatchObject({ ok: false, error: "date_invalid" });
  });
  test("addDays crosses month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("Beta board: design body", () => {
  test("only the sent fields are present, empty clears", () => {
    expect(cleanBetaDesign({ start3dOn: "2026-11-02", person2dId: 5, poDoneOn: null, start2dOn: "" })).toEqual({
      ok: true, value: { start3dOn: "2026-11-02", person2dIds: [5], poDoneOn: null, start2dOn: null },
    });
  });
  test("3D and 2D take several people, in order, duplicates dropped; the old single field still works", () => {
    expect(cleanBetaDesign({ person3dIds: [4, 2, 4], person2dIds: [] })).toEqual({ ok: true, value: { person3dIds: [4, 2], person2dIds: [] } });
    expect(cleanBetaDesign({ person3dId: null })).toEqual({ ok: true, value: { person3dIds: [] } });
    // The list wins when both are sent.
    expect(cleanBetaDesign({ person3dIds: [7], person3dId: 8 })).toEqual({ ok: true, value: { person3dIds: [7] } });
    expect(cleanBetaDesign({ person3dIds: [1, "2"] })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanBetaDesign({ person2dIds: 3 })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanBetaDesign({ person2dIds: Array.from({ length: 11 }, (_, i) => i + 1) })).toMatchObject({ ok: false, error: "too_many_people" });
  });
  test("bad date, bad person or an empty body is refused", () => {
    expect(cleanBetaDesign({ start3dOn: "2026-02-30" })).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanBetaDesign({ person3dId: "7" })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanBetaDesign({ person3dId: 0 })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanBetaDesign({})).toMatchObject({ ok: false, error: "nothing_to_change" });
    expect(cleanBetaDesign({ unknown: 1 })).toMatchObject({ ok: false, error: "nothing_to_change" });
  });
  test("person ids and the activity note", () => {
    const patch = { start3dOn: "2026-11-02", person2dIds: [5, 6], person3dIds: [], poDoneOn: null };
    expect(designPersonIds(patch)).toEqual([5, 6]);
    expect(designPersonIds({ person3dIds: [5], person2dIds: [5, 7] })).toEqual([5, 7]);
    expect(designChangeNote(patch, new Map([[5, "Aisha"], [6, "Ben"]]))).toBe("3D starts 2026-11-02 · 3D person cleared · 2D by Aisha, Ben · PO done cleared");
  });
});

describe("Beta board: other bodies", () => {
  test("amendment days 1 to 60, whole numbers", () => {
    expect(cleanNoteDays({ days: 3 })).toEqual({ ok: true, value: { days: 3 } });
    expect(cleanNoteDays({ days: 60 })).toMatchObject({ ok: true });
    for (const days of [0, 61, 1.5, "3", null, undefined]) expect(cleanNoteDays({ days })).toMatchObject({ ok: false, error: "days_invalid" });
  });
  test("clock times", () => {
    expect(["00:00", "09:30", "23:59"].every(isClockTime)).toBe(true);
    expect(["24:00", "9:30", "12:60", "12:30:00", "", null].some(isClockTime)).toBe(false);
  });
  test("appointment", () => {
    expect(cleanBetaAppointment({ onDate: "2026-11-03", atTime: "10:00", personId: 4, withText: " Mr Tan " })).toEqual({
      ok: true, value: { onDate: "2026-11-03", atTime: "10:00", personId: 4, withText: "Mr Tan" },
    });
    expect(cleanBetaAppointment({ onDate: "2026-11-03" })).toEqual({ ok: true, value: { onDate: "2026-11-03", atTime: null, personId: null, withText: null } });
    expect(cleanBetaAppointment({ onDate: "3/11/2026" })).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanBetaAppointment({ onDate: "2026-11-03", atTime: "25:00" })).toMatchObject({ ok: false, error: "time_invalid" });
    expect(cleanBetaAppointment({ onDate: "2026-11-03", withText: "x".repeat(501) })).toMatchObject({ ok: false, error: "text_invalid" });
    expect(cleanBetaAppointment({ onDate: "2026-11-03", withText: "x".repeat(500) })).toMatchObject({ ok: true });
  });
  test("event create", () => {
    expect(cleanBetaEvent({ projectId: 9, onDate: "2026-11-03", atTime: "14:15", type: "client", note: "Walk through", personId: 2 })).toEqual({
      ok: true, value: { projectId: 9, onDate: "2026-11-03", atTime: "14:15", type: "client", note: "Walk through", personId: 2 },
    });
    expect(cleanBetaEvent({ onDate: "2026-11-03", type: "meeting" })).toMatchObject({ ok: true, value: { projectId: null, note: null, personId: null } });
    for (const type of ["client", "measure", "briefing", "meeting", "w3d", "w2d", "amend", "po", "update"]) {
      expect(cleanBetaEvent({ onDate: "2026-11-03", type }).ok).toBe(true);
    }
    expect(cleanBetaEvent({ onDate: "2026-11-03", type: "party" })).toMatchObject({ ok: false, error: "type_invalid" });
    expect(cleanBetaEvent({ onDate: "2026-11-03", type: "po", projectId: "9" })).toMatchObject({ ok: false, error: "project_invalid" });
    expect(cleanBetaEvent({ onDate: "2026-11-03", type: "po", note: "x".repeat(501) })).toMatchObject({ ok: false, error: "note_invalid" });
  });
  test("event change keeps only what was sent", () => {
    expect(cleanBetaEventPatch({ done: true })).toEqual({ ok: true, value: { done: true } });
    expect(cleanBetaEventPatch({ atTime: "", note: null })).toEqual({ ok: true, value: { atTime: null, note: null } });
    expect(cleanBetaEventPatch({ done: "yes" })).toMatchObject({ ok: false, error: "done_invalid" });
    expect(cleanBetaEventPatch({ type: "nope" })).toMatchObject({ ok: false, error: "type_invalid" });
    expect(cleanBetaEventPatch({})).toMatchObject({ ok: false, error: "nothing_to_change" });
  });
});

describe("Beta board: grouping", () => {
  test("groupByProject keeps the order inside each project", () => {
    const g = groupByProject([{ project_id: 2, n: "a" }, { project_id: 1, n: "b" }, { project_id: 2, n: "c" }]);
    expect(g.get(2)?.map((r) => r.n)).toEqual(["a", "c"]);
    expect(g.get(1)?.map((r) => r.n)).toEqual(["b"]);
    expect(g.get(3)).toBeUndefined();
  });
  test("roles from an array or the text form", () => {
    expect(rolesOf(["designer", "sales"])).toEqual(["designer", "sales"]);
    expect(rolesOf("{designer,reno_pic}")).toEqual(["designer", "reno_pic"]);
    expect(rolesOf("{}")).toEqual([]);
    expect(rolesOf(null)).toEqual([]);
  });
  test("created_at becomes the Malaysian day", () => {
    expect(createdOnOf("2026-10-22T17:30:00Z")).toBe("2026-10-23");
    expect(createdOnOf("2026-10-22T15:30:00Z")).toBe("2026-10-22");
    expect(createdOnOf(null)).toBeNull();
    expect(createdOnOf("not a time")).toBeNull();
  });
  test("a project row picks up only its own groups", () => {
    const row: BoardProjectRow = {
      id: 1, code: "P-1", name: "Unit A", building: "Skyline", unit_no: "A-1", customer_name: "Tan", sales_name: "Lim", created_at: "2026-10-01T00:00:00Z",
      handover_on: "2026-12-01", lead_id: 3, lead_name: "Aisha", pic_id: null, pic_name: null, p3_people: '[{"id":4,"name":"Ben"},{"id":6,"name":"Cik Siti"}]', p2_people: [],
      measured_on: "2026-10-05", start_3d_on: null, start_2d_on: null, po_done_on: null,
    };
    const sets = {
      files: groupByProject([{ id: 10, project_id: 1, kind: "3d" as const, version: 1, submitted_on: "2026-10-12" }, { id: 11, project_id: 2, kind: "2d" as const, version: 1, submitted_on: "2026-10-13" }]),
      notes: groupByProject([{ id: 5, project_id: 1, kind: "3d" as const, noted_on: "2026-10-14", closed_on: null, days: null }]),
      reviews: groupByProject([{ file_id: 10, project_id: 1, sent_on: "2026-10-12", approved_on: null }]),
      appointments: groupByProject([{ project_id: 1, kind: "site_measure" as const, on_date: "2026-10-05", at_time: "10:00", person_id: 3, with_text: null, done_at: null }]),
    };
    const p = buildBoardProject(row, sets, { state: "ok", label: "2nd payment" });
    expect(p).toMatchObject({
      id: 1, unitNo: "A-1", salesName: "Lim", createdOn: "2026-10-01", handoverOn: "2026-12-01",
      lead: { id: 3, name: "Aisha" }, person3d: { id: 4, name: "Ben" }, person2d: null, sitePic: null, measuredOn: "2026-10-05",
      people3d: [{ id: 4, name: "Ben" }, { id: 6, name: "Cik Siti" }], people2d: [],
      files: [{ id: 10, kind: "3d", version: 1, submittedOn: "2026-10-12" }],
      notes: [{ id: 5, kind: "3d", notedOn: "2026-10-14", closedOn: null, days: null }],
      reviews: [{ fileId: 10, sentOn: "2026-10-12", approvedOn: null }],
      appointments: [{ kind: "site_measure", onDate: "2026-10-05", atTime: "10:00", personId: 3, withText: null, doneAt: null }],
      payment: { state: "ok", label: "2nd payment" },
    });
    expect(buildBoardProject({ ...row, id: 9 }, sets, { state: "none" })).toMatchObject({ files: [], notes: [], reviews: [], appointments: [], payment: { state: "none" } });
  });
});

describe("Beta board: timeline titles", () => {
  test("each new action reads as a sentence", () => {
    expect(activityText({ action: "beta_design_changed", note: "3D starts 2026-11-02" })).toEqual({ title: "Design dates changed", body: "3D starts 2026-11-02" });
    expect(activityText({ action: "beta_note_days", from_value: "3D", to_value: "5" })).toEqual({ title: "Amendment time changed", body: "3D: 5 days" });
    expect(activityText({ action: "beta_appointment_booked", to_value: "site_measure", note: "On 2026-11-03" })).toEqual({ title: "Site measure booked", body: "On 2026-11-03" });
    expect(activityText({ action: "beta_appointment_done", to_value: "carpentry_measure" })).toMatchObject({ title: "Carpentry measure done" });
    expect(activityText({ action: "beta_appointment_removed", to_value: "site_briefing" })).toMatchObject({ title: "Site briefing removed" });
    expect(activityText({ action: "beta_event_added", to_value: "w3d", note: "2026-11-03 · Draw" })).toEqual({ title: "Calendar entry added", body: "W3d · 2026-11-03 · Draw" });
    expect(activityText({ action: "beta_event_changed", to_value: "client" })).toEqual({ title: "Calendar entry changed", body: "Client" });
    expect(activityText({ action: "beta_event_removed", to_value: "client" })).toEqual({ title: "Calendar entry removed", body: "Client" });
  });
});
