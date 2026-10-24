import { describe, expect, it } from "vitest";
import { cleanLinkSet, cleanSheetName, cleanSheetRename, cleanSheetSet, linkVersionName, sheetKindOf, sheetVersionName } from "../src/services/renovation/betaSheets";

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

describe("cleanLinkSet (3D links in one version)", () => {
  const ok = { submittedOn: "2026-10-24", personIds: [4], nextPersonId: 9, links: [{ name: " Living  room ", url: "https://kuula.co/a" }, { name: "Bedroom", url: "https://my.matterport.com/b" }] };
  it("takes several named links", () => {
    expect(cleanLinkSet(ok, "2026-10-24")).toEqual({ ok: true, value: { submittedOn: "2026-10-24", personIds: [4], nextPersonId: 9, note: null,
      links: [{ name: "Living room", url: "https://kuula.co/a" }, { name: "Bedroom", url: "https://my.matterport.com/b" }] } });
  });
  it("refuses no links, a nameless link, a bad address, a repeated name and a future date", () => {
    expect(cleanLinkSet({ links: [] }, "2026-10-24")).toMatchObject({ ok: false, error: "links_required" });
    expect(cleanLinkSet({ links: [{ name: "", url: "https://x.y" }] }, "2026-10-24")).toMatchObject({ ok: false, error: "name_required" });
    expect(cleanLinkSet({ links: [{ name: "A", url: "ftp://x" }] }, "2026-10-24")).toMatchObject({ ok: false, error: "url_invalid" });
    expect(cleanLinkSet({ links: [{ name: "A", url: "https://x" }, { name: "a", url: "https://y" }] }, "2026-10-24")).toMatchObject({ ok: false, error: "name_duplicate" });
    expect(cleanLinkSet({ ...ok, submittedOn: "2026-10-25" }, "2026-10-24")).toMatchObject({ ok: false, error: "date_in_future" });
    expect(cleanLinkSet({ ...ok, nextPersonId: "x" }, "2026-10-24")).toMatchObject({ ok: false, error: "person_invalid" });
  });
  it("names the version and reads the kind", () => {
    expect(linkVersionName(true, 3)).toBe("3D set, 3 links");
    expect(linkVersionName(false, 1)).toBe("1 link updated");
    expect(sheetKindOf("3d")).toBe("3d");
    expect(sheetKindOf(undefined)).toBe("2d");
  });
});
