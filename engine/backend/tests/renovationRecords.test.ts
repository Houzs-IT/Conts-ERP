import { describe, expect, test } from "vitest";
import { cleanAttending, cleanDesignFilePatch, cleanDesignKind, cleanDesignLink, cleanDesignNote, cleanHold, cleanKeyMove, cleanManualStep, cleanPerson, cleanSiteMeasure } from "../src/services/renovation/records";
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

describe("project PIC and attending (owner, 14 Oct 2026)", () => {
  test("attending is a de-duplicated list of person ids; empty clears it", () => {
    expect(cleanAttending({ attendingPersonIds: [3, "4", 3] })).toEqual({ ok: true, value: [3, 4] });
    expect(cleanAttending({ attendingPersonIds: [] })).toEqual({ ok: true, value: [] });
    expect(cleanAttending({ attendingPersonIds: [1, "x"] })).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanAttending({ attendingPersonIds: "1,2" })).toMatchObject({ ok: false, error: "person_invalid" });
  });
});

describe("design: 3D / 2D submissions by link and change notes", () => {
  test("a link submission needs an http(s) address; dates default to today and never lie ahead", () => {
    expect(cleanDesignLink({ kind: "3d", url: "https://drive.example/x", personId: 3, nextPersonId: 4 }, TODAY))
      .toEqual({ ok: true, value: { kind: "3d", url: "https://drive.example/x", submittedOn: TODAY, personId: 3, personIds: [3], nextPersonId: 4, note: null } });
    expect(cleanDesignLink({ kind: "3d", url: "javascript:alert(1)" }, TODAY)).toMatchObject({ ok: false, error: "url_invalid" });
    expect(cleanDesignLink({ kind: "4d", url: "https://x.example" }, TODAY)).toMatchObject({ ok: false, error: "kind_invalid" });
    expect(cleanDesignLink({ kind: "2d", url: "https://x.example", submittedOn: "2026-12-01" }, TODAY)).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanDesignLink({ kind: "2d", url: "https://x.example", nextPersonId: 4 }, TODAY)).toMatchObject({ ok: true, value: { nextPersonId: null } });
  });
  test("a note needs text; requested by is a person, free text, or nobody", () => {
    expect(cleanDesignNote({ kind: "3d", note: " move the TV wall ", requestedByPersonId: 2 }, TODAY))
      .toEqual({ ok: true, value: { kind: "3d", notedOn: TODAY, requestedByPersonId: 2, requestedByText: null, note: "move the TV wall" } });
    expect(cleanDesignNote({ kind: "2d", note: "x", requestedByText: " Owner's wife " }, TODAY)).toMatchObject({ ok: true, value: { requestedByText: "Owner's wife", requestedByPersonId: null } });
    expect(cleanDesignNote({ kind: "3d", note: " " }, TODAY)).toMatchObject({ ok: false, error: "note_required" });
    expect(cleanDesignNote({ kind: "other", note: "x" }, TODAY)).toMatchObject({ ok: false, error: "kind_invalid" });
    expect(cleanDesignNote({ kind: "3d", note: "x", notedOn: "11/10/2026" }, TODAY)).toMatchObject({ ok: false, error: "date_invalid" });
  });
});

describe("several PICs (owner, 14 Oct 2026)", () => {
  test("onsite: personIds, de-duplicated, first one is personId; the old single personId still works", () => {
    expect(cleanSiteMeasure({ doneOn: "2026-10-02", personIds: [5, "3", 5], note: " key from guard " }))
      .toEqual({ ok: true, value: { doneOn: "2026-10-02", personId: 5, personIds: [5, 3], note: "key from guard" } });
    expect(cleanSiteMeasure({ doneOn: "2026-10-02", personId: 4 })).toMatchObject({ ok: true, value: { personId: 4, personIds: [4] } });
    expect(cleanSiteMeasure({ doneOn: "2026-10-02" })).toMatchObject({ ok: true, value: { personId: null, personIds: [] } });
    expect(cleanSiteMeasure({ doneOn: "2026-10-02", personIds: [1, "x"] })).toMatchObject({ ok: false, error: "person_invalid" });
  });
  test("3D link: personIds", () => {
    expect(cleanDesignLink({ kind: "3d", url: "https://x.example", personIds: [3, 7] }, TODAY)).toMatchObject({ ok: true, value: { personId: 3, personIds: [3, 7] } });
  });
});

describe("editing a key move", () => {
  test("the same rules as a new one", () => {
    expect(cleanKeyMove({ movedOn: "2026-10-05", fromPersonId: null, toPersonId: 9 }, TODAY)).toMatchObject({ ok: true, value: { fromPersonId: null, toPersonId: 9 } });
    expect(cleanKeyMove({ movedOn: "2026-10-05", fromPersonId: 9, toPersonId: 9 }, TODAY)).toMatchObject({ ok: false, error: "same_person" });
  });
});

describe("editing a design version (owner, 14 Oct 2026)", () => {
  test("only what is sent changes; PICs, 2D PIC, submit date and the link are checked like a new one", () => {
    expect(cleanDesignFilePatch({ personIds: [4, 4, 2] }, TODAY)).toEqual({ ok: true, value: { personIds: [4, 2], personId: 4 } });
    expect(cleanDesignFilePatch({ nextPersonId: null, submittedOn: "2026-10-01" }, TODAY)).toEqual({ ok: true, value: { nextPersonId: null, submittedOn: "2026-10-01" } });
    expect(cleanDesignFilePatch({ url: "https://drive.example/v2" }, TODAY)).toEqual({ ok: true, value: { url: "https://drive.example/v2" } });
    expect(cleanDesignFilePatch({ url: "ftp://x" }, TODAY)).toMatchObject({ ok: false, error: "url_invalid" });
    expect(cleanDesignFilePatch({ submittedOn: "2026-12-01" }, TODAY)).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanDesignFilePatch({ personIds: ["a"] }, TODAY)).toMatchObject({ ok: false, error: "person_invalid" });
    expect(cleanDesignFilePatch({}, TODAY)).toEqual({ ok: true, value: {} });
  });
});
