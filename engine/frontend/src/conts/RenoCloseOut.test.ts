import { describe, expect, it } from "vitest";
import { closeOutRows } from "./RenoCloseOut";
import { alertsOf, type RenoProjectRow } from "./renoProjectsQueries";

// The Close-out tab (SOP 4.2.2; plan 2026-11-02-renovation-close-out Task 3): handed-over projects only, filtered
// Open / Closed / All; a handed-over project not closed raises "Not closed" on the status table.
const row = (soDocNo: string, closeOut: RenoProjectRow["closeOut"]) => ({ soDocNo, closeOut } as unknown as RenoProjectRow);
const OPEN = { closed: false, checks: [{ key: "deposit" as const, ok: false, text: "RM 200.00 deposit not returned" }] };
const DONE = { closed: true, checks: [] };

describe("close-out rows", () => {
  const rows = [row("A", null), row("B", OPEN), row("C", DONE)];
  it("lists handed-over projects by filter", () => {
    expect(closeOutRows(rows, "open").map((r) => r.soDocNo)).toEqual(["B"]);
    expect(closeOutRows(rows, "closed").map((r) => r.soDocNo)).toEqual(["C"]);
    expect(closeOutRows(rows, "all").map((r) => r.soDocNo)).toEqual(["B", "C"]);
  });
  it("a handed-over project not closed says so on the status table", () => {
    expect(alertsOf(row("B", OPEN))).toContain("Not closed");
    expect(alertsOf(row("C", DONE))).not.toContain("Not closed");
    expect(alertsOf(row("A", null))).not.toContain("Not closed");
  });
});
