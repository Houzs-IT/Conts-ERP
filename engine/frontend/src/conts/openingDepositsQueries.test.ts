import { describe, expect, it } from "vitest";
import { OPENING_DEPOSIT_COLUMNS, parseOpeningDepositsGrid } from "./openingDepositsQueries";

// Opening deposits by project or unit (chew 2 Nov 2026; plan 2026-11-02-renovation-close-out Task 2): one row per
// deposit still out at go-live, on its 330 account, by project code or by building and unit; amounts in RM.
describe("opening deposits sheet", () => {
  it("reads project rows and unit rows", () => {
    const sheet = parseOpeningDepositsGrid([
      [...OPENING_DEPOSIT_COLUMNS],
      ["330-0040", "RN-2607-003", "", "", "1,000.00", "SKYLINE MC"],
      ["330-0020", "", "ASTER HILL", "A-3-1", 300, "TNB"],
    ]);
    expect(sheet.error).toBeNull();
    expect(sheet.rows.map((r) => r.value)).toEqual([
      { accountCode: "330-0040", projectCode: "RN-2607-003", building: null, unitNumber: null, amountSen: 100_000, paidTo: "SKYLINE MC" },
      { accountCode: "330-0020", projectCode: null, building: "ASTER HILL", unitNumber: "A-3-1", amountSen: 30_000, paidTo: "TNB" },
    ]);
    expect(sheet.rows.every((r) => r.error === null)).toBe(true);
  });

  it("names a row with no account, no amount, or both or neither of project and unit", () => {
    const sheet = parseOpeningDepositsGrid([
      [...OPENING_DEPOSIT_COLUMNS],
      ["", "RN-1", "", "", 10, ""],
      ["330-0040", "RN-1", "", "", "abc", ""],
      ["330-0040", "RN-1", "ASTER HILL", "A-3-1", 10, ""],
      ["330-0040", "", "", "", 10, ""],
    ]);
    expect(sheet.rows.map((r) => r.error)).toEqual([
      "No account.", "The amount is not a plain RM figure.", "Name a project code or a unit, not both.", "Name a project code or a unit (building and unit).",
    ]);
  });
});
