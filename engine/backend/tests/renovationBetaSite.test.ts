import { describe, expect, test } from "vitest";
import {
  betaCategory, cleanAssignee, cleanDefectPatch, defectPatchNote, sortDeliveries, uniqueAreas, type SiteDelivery,
} from "../src/services/renovation/betaSite";

describe("Beta site: areas and deliveries", () => {
  test("areas are trimmed, de-duplicated without case, first spelling kept", () => {
    expect(uniqueAreas([" Kitchen ", "kitchen", null, "", "Master  bedroom", "Living"])).toEqual(["Kitchen", "Master bedroom", "Living"]);
  });

  test("deliveries newest first, undated last", () => {
    const d = (no: string, at: string | null): SiteDelivery => ({ type: "delivery_order", id: no, no, at, status: "DELIVERED", from: null, poNumber: null, poIds: [], areas: [], photos: [] });
    expect(sortDeliveries([d("a", "2026-10-01T00:00:00Z"), d("b", null), d("c", "2026-10-05T00:00:00Z")]).map((x) => x.no)).toEqual(["c", "a", "b"]);
  });
});

describe("Beta defects: ticket edits", () => {
  test("only the fields sent change", () => {
    expect(cleanDefectPatch({ assigneePersonId: 4, dueDate: "2026-11-01" })).toEqual({ ok: true, value: { assigneePersonId: 4, dueDate: "2026-11-01" } });
    expect(cleanDefectPatch({ assigneePersonId: null, trade: "", location: "  " })).toEqual({ ok: true, value: { assigneePersonId: null, trade: null, location: null } });
  });

  test("refuses bad values and an empty edit", () => {
    expect(cleanDefectPatch({})).toMatchObject({ ok: false, error: "nothing_to_change" });
    expect(cleanDefectPatch({ assigneePersonId: "x" })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanDefectPatch({ trade: "chef" })).toMatchObject({ ok: false, error: "trade_invalid" });
    expect(cleanDefectPatch({ dueDate: "2026-02-31" })).toMatchObject({ ok: false, error: "date_invalid" });
    expect(cleanDefectPatch({ description: " " })).toMatchObject({ ok: false, error: "description_required" });
  });

  test("the assignee when reporting is optional", () => {
    expect(cleanAssignee({})).toEqual({ ok: true, value: null });
    expect(cleanAssignee({ assigneePersonId: 3 })).toEqual({ ok: true, value: 3 });
    expect(cleanAssignee({ assigneePersonId: -1 })).toMatchObject({ ok: false });
  });

  test("the activity note says what changed", () => {
    expect(defectPatchNote({ assigneePersonId: 3, dueDate: "2026-11-01" }, "Ali")).toBe("To fix: Ali · Fix by 2026-11-01");
    expect(defectPatchNote({ assigneePersonId: null }, null)).toBe("No one named to fix it");
  });
});

describe("Beta timeline: filters", () => {
  const e = (id: string, title: string) => ({ id, category: "system" as const, title });
  test("each entry is filed under what it is about", () => {
    expect(betaCategory(e("po:1", "Purchase order PO-1 created"))).toBe("supplier");
    expect(betaCategory(e("deliv:1", "Delivered: DO-1"))).toBe("supplier");
    expect(betaCategory(e("pay:1", "Payment received RM 10.00"))).toBe("sales");
    expect(betaCategory(e("vo:1", "Variation order VO-1 drafted"))).toBe("sales");
    expect(betaCategory(e("design:1", "3D v1 submitted"))).toBe("design");
    expect(betaCategory(e("act:1", "Defect reported"))).toBe("site");
    expect(betaCategory(e("act:2", "2D v2 approved by Mr Tan"))).toBe("design");
    expect(betaCategory(e("act:3", "Site measure booked"))).toBe("design");
    expect(betaCategory(e("act:4", "Reminder sent"))).toBe("customer");
    expect(betaCategory(e("act:5", "Project created"))).toBe("system");
    expect(betaCategory({ id: "note:1", category: "customer", title: null })).toBe("customer");
  });
});
