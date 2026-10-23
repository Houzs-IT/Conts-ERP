import { describe, expect, it } from "vitest";
import type { DesignFile } from "../projects/renovation/simpleApi";
import { sheetNameOf, sheetSetAt, type BetaSheet } from "./renovationBetaSheets";

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
  it("drops the extension and underscores", () => {
    expect(sheetNameOf("A-01_Floor_plan.pdf")).toBe("A-01 Floor plan");
  });
});
