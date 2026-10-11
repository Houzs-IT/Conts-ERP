import { describe, expect, test } from "vitest";
import { cleanDesignKind, cleanHold, cleanKeyMove, cleanManualStep, cleanPerson, cleanSiteMeasure } from "../src/services/renovation/records";
import { boardRowOf } from "../src/services/renovation/boardRow";
import type { ProjectFacts } from "../src/services/renovation/load";
import type { ProjectView } from "../src/services/renovation/view";

const TODAY = "2026-10-11";

describe("people master", () => {
  test("a person needs a name; roles must be known ones and are de-duplicated", () => {
    expect(cleanPerson({ name: " " })).toMatchObject({ ok: false, error: "name_required" });
    expect(cleanPerson({ name: "Alex", roles: ["reno_pic", "pilot"] })).toMatchObject({ ok: false, error: "role_invalid" });
    expect(cleanPerson({ name: " Alex ", roles: ["reno_pic", "reno_pic", "site_crew"] }))
      .toEqual({ ok: true, value: { name: "Alex", roles: ["reno_pic", "site_crew"], active: true, userId: null, phone: null, notes: null } });
  });
  test("a patch returns only what it was given", () => {
    expect(cleanPerson({ active: false }, true)).toEqual({ ok: true, value: { active: false } });
    expect(cleanPerson({ name: "" }, true)).toMatchObject({ ok: false, error: "name_required" });
  });
});

describe("unit key moves", () => {
  test("from or to, never the same person, never in the future", () => {
    expect(cleanKeyMove({ fromPersonId: 1, toPersonId: 2, movedOn: "2026-10-01" }, TODAY)).toMatchObject({ ok: true, value: { fromPersonId: 1, toPersonId: 2 } });
    expect(cleanKeyMove({ toPersonId: 2 }, TODAY)).toMatchObject({ ok: true, value: { movedOn: TODAY, fromPersonId: null } });
    expect(cleanKeyMove({}, TODAY)).toMatchObject({ ok: false, error: "person_required" });
    expect(cleanKeyMove({ fromPersonId: 3, toPersonId: 3 }, TODAY)).toMatchObject({ ok: false, error: "same_person" });
    expect(cleanKeyMove({ toPersonId: 3, movedOn: "2026-12-01" }, TODAY)).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanKeyMove({ toPersonId: "x" }, TODAY)).toMatchObject({ ok: false, error: "person_invalid" });
  });
});

describe("design records", () => {
  test("a site measure needs a date; the person is optional", () => {
    expect(cleanSiteMeasure({})).toMatchObject({ ok: false, error: "date_required" });
    expect(cleanSiteMeasure({ doneOn: "2026-10-02", personId: 4 })).toMatchObject({ ok: true, value: { personId: 4 } });
  });
  test("file kinds are 2d, 3d or other", () => {
    expect(cleanDesignKind("2D")).toBe("2d");
    expect(cleanDesignKind("cad")).toBeNull();
  });
});

describe("manual step and hold flag", () => {
  test("only the six step keys; reason optional", () => {
    expect(cleanManualStep({ step: "ordering" })).toEqual({ ok: true, value: { step: "ordering", reason: null } });
    expect(cleanManualStep({ step: "hardware" })).toMatchObject({ ok: false, error: "step_invalid" });
  });
  test("hold is in defect or on hold", () => {
    expect(cleanHold({ flag: "in_defect", note: "water leak" })).toEqual({ ok: true, value: { flag: "in_defect", note: "water leak" } });
    expect(cleanHold({ flag: "late" })).toMatchObject({ ok: false });
  });
});

describe("board row", () => {
  const f = {
    project: { id: 3, code: "RN-2610-001", name: "BARON C-20-08 MR ALBERT", building: "BARON", unit_no: "C-20-08", customer_name: "MR ALBERT",
      salesperson_name: "old text", sales_person_id: 5, sales_person_name: "Michell", planned_handover_date: null, handed_over_at: null,
      archived_at: null, source: "import", source_ref: "notion-page-1" },
    so: { doc_no: "SO-1", so_date: "2026-09-01", agent: "MK" },
    handover: { signed_at: "2026-10-05T03:00:00Z" },
  } as unknown as ProjectFacts;
  const v = {
    flow: { current: "renovation", currentLabel: "Renovation", currentIndex: 3, steps: new Array(6), manualInEffect: true },
    hold: { flag: "in_defect", note: "leak", at: null },
    money: { contractSen: 100_00, receivedSen: 40_00, receivedPct: 40 },
    conditions: { furniture: { condition: "pending_arrived" }, renoItem: null },
    keyHolder: { personId: 2, name: "Alex", movedOn: "2026-10-01" },
    vo: { count: 2, approved: 1 },
    redFlags: [{ code: "billing_due", text: "" }, { code: "task_overdue", text: "" }],
  } as unknown as ProjectView;

  test("carries every board column, the hold flag first in the status", () => {
    const r = boardRowOf(f, v, { hideMoney: false });
    expect(r).toMatchObject({
      building: "BARON", soDocNo: "SO-1", sales: { personId: 5, name: "Michell" }, contractSen: 100_00, receivedPct: 40,
      statusText: "IN DEFECT · Renovation", step: { key: "renovation", manual: true, count: 6 },
      furnitureArrival: "pending_arrived", renoItemArrival: null, keyHolder: { name: "Alex" },
      vo: { has: true, count: 2, approved: 1 }, handoverDate: "2026-10-05", source: "import", sourceRef: "notion-page-1", redFlagCount: 2,
    });
  });

  test("money hidden from a user without finance access", () => {
    const r = boardRowOf(f, v, { hideMoney: true });
    expect(r).toMatchObject({ contractSen: null, receivedSen: null, receivedPct: null, moneyHidden: true, redFlagCount: 1 });
  });
});
