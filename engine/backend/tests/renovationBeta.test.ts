import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import renovationBeta from "../src/routes/renovationBeta";
import {
  cleanBetaReminder, cleanBetaSettings, cleanDefectFixed, cleanDefectRedo, cleanDefectReport, cleanDesignApproval, cleanDesignSent,
  defectMoveRefusal, defectState, designLabel, instalmentStatus, isIsoDay, paymentsOf,
} from "../src/services/renovation/beta";
import { activityText } from "../src/services/renovation/timeline";
import type { BillingInstalment, BillingView } from "../src/scm/lib/renovation-billing";

describe("Beta routes: the switch", () => {
  const app = new Hono();
  app.route("/api/beta", renovationBeta);
  const routes = renovationBeta.routes.filter((r) => r.method !== "ALL");

  test("the router has the bundle A and section 10 routes", () => {
    // Hono lists each middleware of a route as its own entry, so the names are de-duplicated.
    const names = [...new Set(routes.map((r) => `${r.method} ${r.path}`))].sort();
    expect(names).toEqual([
      "DELETE /design-files/:fileId/approval",
      "DELETE /events/:id",
      "DELETE /projects/:id/appointments/:kind",
      "GET /board",
      "GET /projects/:id/defects",
      "GET /projects/:id/site",
      "GET /projects/:id/timeline",
      "GET /projects/:id/workspace",
      "PATCH /defects/:defectId",
      "PATCH /events/:id",
      "POST /defects/:defectId/close",
      "POST /defects/:defectId/fixed",
      "POST /defects/:defectId/redo",
      "POST /design-files/:fileId/approval",
      "POST /design-files/:fileId/sent",
      "POST /events",
      "POST /projects/:id/appointments/:kind/done",
      "POST /projects/:id/defects",
      "POST /projects/:id/reminders",
      "PUT /design-notes/:noteId/days",
      "PUT /projects/:id/appointments/:kind",
      "PUT /projects/:id/design",
      "PUT /settings",
    ]);
  });

  // Beta has no switch (owner, 23 Oct 2026): every route sits behind the normal sign-in gate.
  test("every route needs a session (no session: 401)", async () => {
    for (const r of routes) {
      const path = `/api/beta${r.path.replace(":id", "1").replace(":defectId", "1").replace(":fileId", "1").replace(":noteId", "1").replace(":kind", "site_measure")}`;
      const res = await app.request(path, { method: r.method, headers: { "content-type": "application/json" }, body: r.method === "GET" ? undefined : "{}" }, {});
      expect(res.status, `${r.method} ${path}`).toBe(401);
    }
  });
});

describe("Beta input: defect report", () => {
  const ok = { location: " Kitchen ", description: "  Crack in the top  ", trade: "carpenter", dueDate: "2026-11-02", photoKey: "renovation/7/a.jpg" };
  test("a full report is cleaned", () => {
    expect(cleanDefectReport(ok, 7)).toEqual({
      ok: true,
      value: { location: "Kitchen", description: "Crack in the top", trade: "carpenter", dueDate: "2026-11-02", photoKey: "renovation/7/a.jpg" },
    });
  });
  test("trade and date may be empty or null", () => {
    expect(cleanDefectReport({ ...ok, trade: null, dueDate: null, location: "" }, 7)).toMatchObject({ ok: true, value: { trade: null, dueDate: null, location: null } });
    expect(cleanDefectReport({ ...ok, trade: "", dueDate: "" }, 7)).toMatchObject({ ok: true, value: { trade: null, dueDate: null } });
  });
  test("description and photo are required, the photo must belong to the project", () => {
    expect(cleanDefectReport({ ...ok, description: "   " }, 7)).toMatchObject({ ok: false, error: "description_required" });
    expect(cleanDefectReport({ ...ok, photoKey: undefined }, 7)).toMatchObject({ ok: false, error: "photo_required" });
    expect(cleanDefectReport({ ...ok, photoKey: "renovation/8/a.jpg" }, 7)).toMatchObject({ ok: false, error: "invalid_photo_key" });
    expect(cleanDefectReport({ ...ok, photoKey: "renovation/7/" }, 7)).toMatchObject({ ok: false, error: "invalid_photo_key" });
    expect(cleanDefectReport({ ...ok, photoKey: "renovation/77/a.jpg" }, 7)).toMatchObject({ ok: false, error: "invalid_photo_key" });
  });
  test("a trade outside the list and a bad date are refused", () => {
    expect(cleanDefectReport({ ...ok, trade: "wizard" }, 7)).toMatchObject({ ok: false, error: "trade_invalid" });
    expect(cleanDefectReport({ ...ok, dueDate: "2026-02-31" }, 7)).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanDefectReport({ ...ok, dueDate: "02/11/2026" }, 7)).toMatchObject({ ok: false, error: "date_invalid" });
  });
  test("every trade of the list is accepted", () => {
    for (const t of ["carpenter", "electrician", "plumber", "painter", "plaster", "hacking", "aircon", "tiler", "other"]) {
      expect(cleanDefectReport({ ...ok, trade: t }, 7).ok).toBe(true);
    }
  });
  test("fixed: the after photo is optional but must belong to the project", () => {
    expect(cleanDefectFixed({}, 7)).toEqual({ ok: true, value: { afterPhotoKey: null } });
    expect(cleanDefectFixed({ afterPhotoKey: "renovation/7/b.jpg" }, 7)).toEqual({ ok: true, value: { afterPhotoKey: "renovation/7/b.jpg" } });
    expect(cleanDefectFixed({ afterPhotoKey: "renovation/9/b.jpg" }, 7)).toMatchObject({ ok: false, error: "invalid_photo_key" });
    expect(cleanDefectFixed({ afterPhotoKey: 5 }, 7)).toMatchObject({ ok: false, error: "invalid_photo_key" });
  });
  test("redo: an optional text note", () => {
    expect(cleanDefectRedo({})).toEqual({ ok: true, value: { note: null } });
    expect(cleanDefectRedo({ note: " still rough " })).toEqual({ ok: true, value: { note: "still rough" } });
    expect(cleanDefectRedo({ note: 4 })).toMatchObject({ ok: false, error: "note_invalid" });
  });
});

describe("Beta defects: the repair loop", () => {
  const open = { fixedAt: null, closedAt: null };
  const fixed = { fixedAt: "2026-10-20T01:00:00Z", closedAt: null };
  const closed = { fixedAt: "2026-10-20T01:00:00Z", closedAt: "2026-10-21T01:00:00Z" };
  test("state", () => {
    expect(defectState(open)).toBe("open");
    expect(defectState(fixed)).toBe("fixed");
    expect(defectState(closed)).toBe("closed");
    expect(defectState({ fixedAt: null, closedAt: "2026-10-21T01:00:00Z" })).toBe("closed");
  });
  test("fixed: only from open", () => {
    expect(defectMoveRefusal("fixed", open)).toBeNull();
    expect(defectMoveRefusal("fixed", fixed)).toMatchObject({ error: "already_fixed" });
    expect(defectMoveRefusal("fixed", closed)).toMatchObject({ error: "defect_closed" });
  });
  test("redo: only from fixed", () => {
    expect(defectMoveRefusal("redo", fixed)).toBeNull();
    expect(defectMoveRefusal("redo", open)).toMatchObject({ error: "not_fixed" });
    expect(defectMoveRefusal("redo", closed)).toMatchObject({ error: "defect_closed" });
  });
  test("close: from open or fixed, never twice", () => {
    expect(defectMoveRefusal("close", open)).toBeNull();
    expect(defectMoveRefusal("close", fixed)).toBeNull();
    expect(defectMoveRefusal("close", closed)).toMatchObject({ error: "defect_closed" });
  });
});

describe("Beta input: drawings, settings, reminders", () => {
  const TODAY = "2026-10-23";
  test("isIsoDay is a real calendar day", () => {
    expect(isIsoDay("2026-10-23")).toBe(true);
    expect(isIsoDay("2028-02-29")).toBe(true);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2026-13-01")).toBe(false);
    expect(isIsoDay("2026-1-1")).toBe(false);
    expect(isIsoDay(20261023)).toBe(false);
  });
  test("sent: both days, due not before sent", () => {
    expect(cleanDesignSent({ sentOn: "2026-10-20", dueOn: "2026-10-27" }, TODAY)).toEqual({ ok: true, value: { sentOn: "2026-10-20", dueOn: "2026-10-27" } });
    expect(cleanDesignSent({ sentOn: "2026-10-20", dueOn: "2026-10-20" }, TODAY).ok).toBe(true);
    expect(cleanDesignSent({ sentOn: "2026-10-20", dueOn: "2026-10-19" }, TODAY)).toMatchObject({ ok: false, error: "due_before_sent" });
    expect(cleanDesignSent({ sentOn: "2026-10-20" }, TODAY)).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanDesignSent({ dueOn: "2026-10-20" }, TODAY)).toMatchObject({ ok: false, error: "date_invalid" });
  });
  test("approval: day and name required, note optional", () => {
    expect(cleanDesignApproval({ approvedOn: "2026-10-22", approvedByName: " Ms Lim ", note: " ok " }, TODAY)).toEqual({
      ok: true, value: { approvedOn: "2026-10-22", approvedByName: "Ms Lim", note: "ok" },
    });
    expect(cleanDesignApproval({ approvedOn: "2026-10-22", approvedByName: "Ms Lim" }, TODAY)).toMatchObject({ ok: true, value: { note: null } });
    expect(cleanDesignApproval({ approvedOn: "soon", approvedByName: "Ms Lim" }, TODAY)).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanDesignApproval({ approvedOn: "2026-10-22", approvedByName: "  " }, TODAY)).toMatchObject({ ok: false, error: "name_required" });
  });
  test("a sent or approval day after today (Malaysia) is refused, today and earlier pass", () => {
    expect(cleanDesignSent({ sentOn: "2026-10-24", dueOn: "2026-10-30" }, TODAY)).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanDesignSent({ sentOn: "2026-10-23", dueOn: "2026-10-30" }, TODAY).ok).toBe(true);
    expect(cleanDesignApproval({ approvedOn: "2026-10-24", approvedByName: "Ms Lim" }, TODAY)).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanDesignApproval({ approvedOn: "2026-10-23", approvedByName: "Ms Lim" }, TODAY).ok).toBe(true);
    expect(cleanDesignApproval({ approvedOn: "2026-10-01", approvedByName: "Ms Lim" }, TODAY).ok).toBe(true);
  });
  test("settings: whole days 1 to 365", () => {
    expect(cleanBetaSettings({ design3dDays: 10, design2dDays: 12 })).toEqual({ ok: true, value: { design3dDays: 10, design2dDays: 12 } });
    expect(cleanBetaSettings({ design3dDays: 1, design2dDays: 365 }).ok).toBe(true);
    for (const bad of [0, 366, 2.5, "10", null, undefined, -1]) {
      expect(cleanBetaSettings({ design3dDays: bad, design2dDays: 12 })).toMatchObject({ ok: false, error: "days_invalid" });
      expect(cleanBetaSettings({ design3dDays: 10, design2dDays: bad })).toMatchObject({ ok: false, error: "days_invalid" });
    }
  });
  test("reminder: a known kind and 1 to 1000 characters", () => {
    expect(cleanBetaReminder({ kind: "payment", text: " Please pay " })).toEqual({ ok: true, value: { kind: "payment", text: "Please pay" } });
    for (const k of ["client_approval", "client_answer", "defect", "payment"]) expect(cleanBetaReminder({ kind: k, text: "x" }).ok).toBe(true);
    expect(cleanBetaReminder({ kind: "spam", text: "x" })).toMatchObject({ ok: false, error: "kind_invalid" });
    expect(cleanBetaReminder({ kind: "defect", text: "   " })).toMatchObject({ ok: false, error: "text_required" });
    expect(cleanBetaReminder({ kind: "defect", text: "a".repeat(1000) }).ok).toBe(true);
    expect(cleanBetaReminder({ kind: "defect", text: "a".repeat(1001) })).toMatchObject({ ok: false, error: "text_too_long" });
  });
  test("design label", () => {
    expect(designLabel("2d", 3)).toBe("2D v3");
    expect(designLabel("3d", 1)).toBe("3D v1");
    expect(designLabel("other", 2)).toBe("File v2");
  });
});

describe("Beta payments: instalment status", () => {
  test("no bill is not billed; a bill is paid only when what was received covers it", () => {
    expect(instalmentStatus(null)).toBe("not_billed");
    expect(instalmentStatus({ amountSen: 100000, paidSen: 0 })).toBe("billed");
    expect(instalmentStatus({ amountSen: 100000, paidSen: 99999 })).toBe("billed");
    expect(instalmentStatus({ amountSen: 100000, paidSen: 100000 })).toBe("paid");
    expect(instalmentStatus({ amountSen: 100000, paidSen: 120000 })).toBe("paid");
    expect(instalmentStatus({ amountSen: 0, paidSen: 0 })).toBe("paid");
  });

  const inst = (seq: number, bill: BillingInstalment["bill"], amountSen: number): BillingInstalment => ({
    id: `i${seq}`, seq, label: `Payment ${seq}`, pctBp: 3000, cumBp: seq * 3000, description: "", stageCode: seq === 1 ? "hacking" : null, trigger: "stage_start", bill, isNext: false, amountSen,
  });
  const bill = (seq: number, amountSen: number, paidSen: number, kind: "INVOICE" | "CREDIT_NOTE" | "ZERO" = "INVOICE"): NonNullable<BillingInstalment["bill"]> => ({
    instalmentId: `i${seq}`, seq, kind, amountSen, invoiceDate: "2026-10-01", invoiceNumber: "INV-1", salesInvoiceId: null, noteNumber: null, creditNoteId: null, paidSen, invoiceStatus: null, noteStatus: null,
  });
  const view: BillingView = {
    soDocNo: "SO-1", status: "RENO_CONFIRMED", originalContractSen: 1000000, revisedContractSen: 1000000, voTotalSen: 0, billedSen: 600000, receivedSen: 300000, nextSeq: 3,
    instalments: [inst(1, bill(1, 300000, 300000), 300000), inst(2, bill(2, 300000, 0), 300000), inst(3, null, 400000)],
  };

  test("maps the billing view", () => {
    expect(paymentsOf(null)).toEqual({ state: "none" });
    expect(paymentsOf(view)).toEqual({
      state: "ok",
      contractSen: 1000000,
      receivedSen: 300000,
      instalments: [
        { seq: 1, label: "Payment 1", amountSen: 300000, paidSen: 300000, status: "paid", stageCode: "hacking", trigger: "stage_start", paidOn: null, method: null },
        { seq: 2, label: "Payment 2", amountSen: 300000, paidSen: 0, status: "billed", stageCode: null, trigger: "stage_start", paidOn: null, method: null },
        { seq: 3, label: "Payment 3", amountSen: 400000, paidSen: 0, status: "not_billed", stageCode: null, trigger: "stage_start", paidOn: null, method: null },
      ],
    });
  });
  test("a credit note or zero bill counts as paid and carries no money received", () => {
    const v: BillingView = { ...view, instalments: [inst(1, bill(1, -50000, 0, "CREDIT_NOTE"), 0), inst(2, bill(2, 0, 0, "ZERO"), 0)] };
    const p = paymentsOf(v);
    expect(p.state === "ok" && p.instalments.map((i) => i.status)).toEqual(["paid", "paid"]);
  });
  test("an ordinary sales order is four payments, filled by the money recorded on it, oldest first", () => {
    const p = paymentsOf(null, { docNo: "SO-1", totalSen: 900000, receipts: [
      { paidOn: "2026-10-01", amountSen: 300000, method: "Cash" },
      { paidOn: "2026-10-09", amountSen: 0, method: "Cash" },
      { paidOn: "2026-10-20", amountSen: 200000, method: "Online" },
    ] });
    expect(p.state).toBe("ok");
    if (p.state !== "ok") return;
    expect(p.docNo).toBe("SO-1");
    expect(p.receivedSen).toBe(500000);
    expect(p.instalments.map((i) => [i.label, i.status, i.amountSen, i.paidOn])).toEqual([
      ["1st payment", "paid", 300000, "2026-10-01"],
      ["2nd payment", "paid", 200000, "2026-10-20"],
      ["3rd payment", "not_billed", 0, null],
      ["4th payment", "not_billed", 0, null],
    ]);
  });
  test("a sales order with no money yet still shows four empty payments", () => {
    const p = paymentsOf(null, { docNo: "SO-2", totalSen: 0, receipts: [] });
    expect(p.state === "ok" && p.instalments.map((i) => i.status)).toEqual(["not_billed", "not_billed", "not_billed", "not_billed"]);
  });
  test("money recorded on a contract fills its instalments in order", () => {
    const v: BillingView = { ...view, receivedSen: 0, instalments: [inst(1, null, 300000), inst(2, null, 300000)] };
    const p = paymentsOf(v, { docNo: "RN-1", totalSen: 600000, receipts: [{ paidOn: "2026-10-05", amountSen: 400000, method: "Online" }] });
    expect(p.state === "ok" && p.instalments.map((i) => [i.status, i.paidSen, i.paidOn])).toEqual([["paid", 300000, "2026-10-05"], ["not_billed", 100000, null]]);
  });
});

describe("Beta timeline words", () => {
  test("each beta action reads as a sentence", () => {
    expect(activityText({ action: "beta_defect_reported", to_value: "Crack", note: "Kitchen, carpenter" })).toEqual({ title: "Defect reported", body: "Crack · Kitchen, carpenter" });
    expect(activityText({ action: "beta_defect_fixed", to_value: "Crack" })).toEqual({ title: "Defect fixed, waiting for check", body: "Crack" });
    expect(activityText({ action: "beta_defect_redo", to_value: "Crack", note: "still rough" })).toEqual({ title: "Defect sent back to fix", body: "Crack · still rough" });
    expect(activityText({ action: "beta_defect_closed", to_value: "Crack" })).toEqual({ title: "Defect closed", body: "Crack" });
    expect(activityText({ action: "beta_drawing_sent", to_value: "2D v3", note: "Sent 2026-10-20, answer due 2026-10-27" }))
      .toEqual({ title: "2D v3 sent to the customer", body: "Sent 2026-10-20, answer due 2026-10-27" });
    expect(activityText({ action: "beta_drawing_approved", from_value: "Ms Lim", to_value: "2D v3", note: "On 2026-10-22" }))
      .toEqual({ title: "2D v3 approved by Ms Lim", body: "On 2026-10-22" });
    expect(activityText({ action: "beta_drawing_approval_removed", to_value: "2D v3" })).toEqual({ title: "Approval removed", body: "2D v3" });
    expect(activityText({ action: "beta_reminder", to_value: "payment", note: "Please pay" })).toEqual({ title: "Reminder sent", body: "Payment: Please pay" });
  });
});
