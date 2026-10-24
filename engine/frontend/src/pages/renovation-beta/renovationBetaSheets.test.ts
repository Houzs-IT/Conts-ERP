import { describe, expect, it } from "vitest";
import type { DesignFile } from "../projects/renovation/simpleApi";
import { changedAgainst, linkHost, removedSheetsOf, sheetNameOf, sheetSetAt, sizeText, type BetaSheet } from "./renovationBetaSheets";

const file = (id: number, version: number, extra: Partial<DesignFile> = {}): DesignFile => ({
  id, kind: "2d", version, file_name: `v${version}`, r2_key: `k${id}`, external_url: null, person_name: null, uploaded_by_name: null,
  uploaded_at: "2026-10-24T00:00:00Z", note: null, submitted_on: null, next_person_id: null, next_person_name: null, ...extra,
});
const sheet = (id: number, fileId: number, name: string): BetaSheet => ({ id, fileId, name, fileName: `${name}.pdf`, contentType: "application/pdf", size: 1, key: `s${id}`, uploadedAt: "" });

describe("sheetSetAt", () => {
  const files = [file(1, 1), file(2, 2)];
  const sheets = [sheet(1, 1, "A-01"), sheet(2, 1, "A-02"), sheet(3, 2, "a-02 "), sheet(4, 2, "A-03")];

  it("lays a later version's sheets over the set, by name, keeping order and history", () => {
    const set = sheetSetAt(files, sheets, 2);
    expect(set.map((s) => [s.key, s.version])).toEqual([["s1", 1], ["s3", 2], ["s4", 2]]);
    expect(set[1]?.history.map((h) => h.version)).toEqual([2, 1]);
  });

  it("an earlier version shows the set as it was then", () => {
    expect(sheetSetAt(files, sheets, 1).map((s) => s.key)).toEqual(["s1", "s2"]);
  });

  it("a one-file version replaces the set, and the next sheet version starts a new set", () => {
    const fs = [file(1, 1), file(2, 2, { external_url: "https://x", r2_key: null }), file(3, 3)];
    const ss = [sheet(1, 1, "A-01"), sheet(2, 3, "B-01")];
    expect(sheetSetAt(fs, ss, 2).map((s) => s.url)).toEqual(["https://x"]);
    expect(sheetSetAt(fs, ss, 3).map((s) => s.key)).toEqual(["s2"]);
  });
});

describe("sheetNameOf", () => {
  it("is the file name as it is, without the extension (no other name logic)", () => {
    expect(sheetNameOf("A-01_Floor_plan v2.pdf")).toBe("A-01_Floor_plan v2");
    expect(sheetNameOf("Kitchen elevations.JPG")).toBe("Kitchen elevations");
  });
});

describe("removed sheets", () => {
  const files = [file(1, 1), file(2, 2)];
  const gone = (s: BetaSheet): BetaSheet => ({ ...s, removedAt: "2026-10-24 10:00:00+08" });
  const sheets = [sheet(1, 1, "A-01"), gone(sheet(2, 1, "A-02")), gone(sheet(3, 2, "A-02")), sheet(4, 2, "A-03")];

  it("leaves a removed sheet out of every set, and keeps a version with only removed sheets a sheet version", () => {
    expect(sheetSetAt(files, sheets, 2).map((s) => s.key)).toEqual(["s1", "s4"]);
    expect(sheetSetAt(files, sheets, 1).map((s) => s.key)).toEqual(["s1"]);
    const onlyGone = [sheet(1, 1, "A-01"), gone(sheet(2, 2, "A-01"))];
    // V2 held only the removed sheet: it is not a one-file version, so V1's A-01 is not replaced by "v2".
    expect(sheetSetAt(files, onlyGone, 2).map((s) => s.name)).toEqual(["A-01"]);
  });

  it("lists each removed sheet once with all its files, newest first", () => {
    expect(removedSheetsOf(files, sheets)).toEqual([
      { name: "A-02", removedAt: "2026-10-24 10:00:00+08", history: [{ version: 2, key: "s3", url: null, fileName: "A-02.pdf" }, { version: 1, key: "s2", url: null, fileName: "A-02.pdf" }] },
    ]);
  });
});

describe("3D link sets", () => {
  const f3 = (id: number, version: number, extra: Partial<DesignFile> = {}): DesignFile => file(id, version, { kind: "3d", r2_key: null, ...extra });
  const link = (id: number, fileId: number, name: string, url: string): BetaSheet => ({ id, fileId, name, fileName: name, contentType: null, size: null, key: null, url, uploadedAt: "" });

  it("keeps links added one by one (one-file versions) together in one set, newest per name", () => {
    const files = [f3(1, 1, { file_name: "Living", external_url: "https://kuula.co/a" }), f3(2, 2, { file_name: "Bedroom", external_url: "https://kuula.co/b" }),
      f3(3, 3, { file_name: "living", external_url: "https://kuula.co/a2" })];
    const set = sheetSetAt(files, [], 3, "3d");
    expect(set.map((s) => [s.name, s.url, s.version])).toEqual([["living", "https://kuula.co/a2", 3], ["Bedroom", "https://kuula.co/b", 2]]);
    expect(set[0]?.history.map((h) => h.version)).toEqual([3, 1]);
  });

  it("lays a link-set version over the set and leaves 2D files out", () => {
    const files = [f3(1, 1, { file_name: "Living", external_url: "https://kuula.co/a" }), f3(2, 2), file(9, 1)];
    const links = [link(1, 2, "Kitchen", "https://my.matterport.com/k"), link(2, 2, "Living", "https://kuula.co/a3")];
    expect(sheetSetAt(files, links, 2, "3d").map((s) => [s.name, s.url, s.fromSheet])).toEqual([["Living", "https://kuula.co/a3", true], ["Kitchen", "https://my.matterport.com/k", true]]);
  });

  it("names the host people know", () => {
    expect(linkHost("https://kuula.co/share/abc")).toBe("Kuula");
    expect(linkHost("https://my.matterport.com/show/?m=1")).toBe("Matterport");
    expect(linkHost("https://drive.google.com/file/d/1")).toBe("Google Drive");
    expect(linkHost("https://www.example.com/x")).toBe("example.com");
    expect(linkHost("not a link")).toBe("Link");
  });
});

describe("changedAgainst and sizeText", () => {
  const files = [file(1, 1), file(2, 2)];
  const sheets = [sheet(1, 1, "A"), sheet(2, 1, "B"), sheet(3, 2, "B"), sheet(4, 2, "C")];
  it("marks a replaced or new sheet changed against the approved set, the rest same", () => {
    const m = changedAgainst(sheetSetAt(files, sheets, 2), sheetSetAt(files, sheets, 1));
    expect([...m.entries()]).toEqual([["A", false], ["B", true], ["C", true]]);
    expect([...changedAgainst(sheetSetAt(files, sheets, 2), null).values()]).toEqual([false, false, false]);
  });
  it("says sizes in KB or MB", () => {
    expect(sizeText(0)).toBeNull();
    expect(sizeText(2048)).toBe("2 KB");
    expect(sizeText(14_050_000)).toBe("13.4 MB");
  });
});
