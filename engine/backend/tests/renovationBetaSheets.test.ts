import { describe, expect, it } from "vitest";
import { cleanSheetName, cleanSheetRename, cleanSheetSet, sheetVersionName } from "../src/services/renovation/betaSheets";

const ok = { key: "renovation/7/sheet-1-a.pdf", contentType: "application/pdf", size: 10, fileName: "a.pdf" };

describe("cleanSheetSet", () => {
  it("takes a set of named sheets of this project", () => {
    const r = cleanSheetSet({ submittedOn: "2026-10-20", personIds: [3, 3], sheets: [{ ...ok, name: " A-01  Plan " }] }, 7, "2026-10-24");
    expect(r).toEqual({ ok: true, value: { submittedOn: "2026-10-20", personIds: [3], note: null, sheets: [{ ...ok, name: "A-01 Plan" }] } });
  });

  it("refuses a sheet stored for another project, a repeated name, a future date and an empty set", () => {
    expect(cleanSheetSet({ sheets: [{ ...ok, name: "A", key: "renovation/8/sheet-1.pdf" }] }, 7, "2026-10-24")).toMatchObject({ ok: false, error: "key_invalid" });
    expect(cleanSheetSet({ sheets: [{ ...ok, name: "A" }, { ...ok, name: "a" }] }, 7, "2026-10-24")).toMatchObject({ ok: false, error: "name_duplicate" });
    expect(cleanSheetSet({ submittedOn: "2026-10-25", sheets: [{ ...ok, name: "A" }] }, 7, "2026-10-24")).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanSheetSet({ sheets: [] }, 7, "2026-10-24")).toMatchObject({ ok: false, error: "sheets_required" });
    expect(cleanSheetSet({ sheets: [{ ...ok, name: "A", contentType: "text/html" }] }, 7, "2026-10-24")).toMatchObject({ ok: false, error: "unsupported_type" });
  });
});

describe("sheetVersionName", () => {
  it("names the first set and a partial update", () => {
    expect(sheetVersionName(true, 12)).toBe("2D set, 12 sheets");
    expect(sheetVersionName(false, 1)).toBe("1 sheet updated");
  });
});

describe("cleanSheetName", () => {
  it("folds spaces and refuses an empty or long name", () => {
    expect(cleanSheetName("  A-01   Plan ")).toEqual({ ok: true, value: "A-01 Plan" });
    expect(cleanSheetName("  ")).toMatchObject({ ok: false, error: "name_required" });
    expect(cleanSheetName("x".repeat(121))).toMatchObject({ ok: false, error: "name_too_long" });
  });
});

describe("cleanSheetRename", () => {
  const names = ["A-01 Plan", "A-02 Ceiling", "Old elevation"];
  it("renames a sheet of the project to a free name", () => {
    expect(cleanSheetRename({ name: "a-01 plan", newName: " A-01  Floor plan " }, names)).toEqual({ ok: true, value: { from: "a-01 plan", to: "A-01 Floor plan" } });
  });
  it("allows changing only the capitals", () => {
    expect(cleanSheetRename({ name: "A-02 Ceiling", newName: "A-02 CEILING" }, names)).toMatchObject({ ok: true });
  });
  it("refuses a name another sheet has (removed ones count), an unknown sheet and no change", () => {
    expect(cleanSheetRename({ name: "A-01 Plan", newName: "old ELEVATION" }, names)).toMatchObject({ ok: false, error: "name_duplicate" });
    expect(cleanSheetRename({ name: "Z-99", newName: "Z-100" }, names)).toMatchObject({ ok: false, error: "sheet_not_found" });
    expect(cleanSheetRename({ name: "A-01 Plan", newName: "A-01  Plan" }, names)).toMatchObject({ ok: false, error: "unchanged" });
    expect(cleanSheetRename({ name: "A-01 Plan", newName: "" }, names)).toMatchObject({ ok: false, error: "name_required" });
  });
});
