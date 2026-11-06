import { describe, expect, it } from "vitest";
import { costRows } from "./RentalUnitCosts";

// Rental costs by unit (chew 2 Nov 2026; plan 2026-11-02-voucher-purpose Task 4): one row per unit, then Rental's cost
// that names no unit; nothing for no-unit when there is none.
describe("rental unit cost rows", () => {
  const base = { from: "2026-11-01", to: "2026-11-30", accounts: [{ code: "620-0010", name: "REPAIRS" }] };
  it("units, then the no-unit row", () => {
    const rows = costRows({ ...base,
      rows: [{ unitId: "u-a31", building: "ASTER HILL", unitNumber: "A-3-1", byAccount: { "620-0010": 35_000 }, totalSen: 35_000 }],
      noUnitSen: 20_000, noUnitByAccount: { "620-0010": 20_000 } });
    expect(rows.map((r) => [r.key, r.totalSen, !!r.noUnit])).toEqual([["u-a31", 35_000, false], ["no-unit", 20_000, true]]);
  });
  /* SOP 1.1 (chew 4 Nov 2026): each unit says which sub-departments spent on it; the no-unit row names none. */
  it("each unit carries the sub-departments that spent on it", () => {
    const rows = costRows({ ...base,
      rows: [{ unitId: "u-a31", building: "ASTER HILL", unitNumber: "A-3-1", byAccount: { "620-0010": 35_000 }, totalSen: 35_000, subDepartments: ["Cleaning", "Maintenance"] }],
      noUnitSen: 20_000, noUnitByAccount: { "620-0010": 20_000 } });
    expect(rows.map((r) => r.subDepartments)).toEqual([["Cleaning", "Maintenance"], []]);
  });

  it("no no-unit row when there is none", () => {
    expect(costRows({ ...base, rows: [], noUnitSen: 0, noUnitByAccount: {} })).toEqual([]);
  });
});
