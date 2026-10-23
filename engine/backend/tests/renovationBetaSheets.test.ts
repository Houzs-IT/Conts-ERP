import { describe, expect, it } from "vitest";
import { cleanSheetSet, sheetVersionName } from "../src/services/renovation/betaSheets";

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
