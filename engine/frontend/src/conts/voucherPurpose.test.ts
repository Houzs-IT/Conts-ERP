import { describe, expect, it } from "vitest";
import { applyFor, forOfLines, nextLineUnit, whatSwitchingDrops } from "./voucherPurpose";

// Who a payment voucher is for (chew 2 Nov 2026; SOP 3.2; plan 2026-11-02-voucher-purpose Task 3): Rental, Renovation
// or Company sets every line's department; Mixed keeps them per line. A new line takes the unit of the line above
// unless changed by hand.
const L = (department: "" | "rental" | "supply" | "shared", unitId: string | null = null) => ({ department, unitId });

describe("voucher purpose", () => {
  it("reads the purpose from the lines", () => {
    expect(forOfLines([L("rental"), L("rental")])).toBe("rental");
    expect(forOfLines([L("supply")])).toBe("renovation");
    expect(forOfLines([L("shared")])).toBe("company");
    expect(forOfLines([L("rental"), L("shared")])).toBe("mixed");
    expect(forOfLines([L(""), L("")])).toBe("");
    expect(forOfLines([L("rental"), L("")])).toBe("mixed");
  });

  it("sets every line's department, and drops units off Rental", () => {
    expect(applyFor([L("rental", "u1"), L("")], "rental")).toEqual([L("rental", "u1"), L("rental")]);
    expect(applyFor([L("rental", "u1")], "company")).toEqual([L("shared")]);
    expect(applyFor([L("rental", "u1")], "renovation")).toEqual([L("supply")]);
    expect(applyFor([L("rental", "u1"), L("shared")], "mixed")).toEqual([L("rental", "u1"), L("shared")]);
  });

  it("says what a switch would drop, so the screen can ask first", () => {
    expect(whatSwitchingDrops([L("rental", "u1")], 7, "company")).toEqual(["the units", "the project"]);
    expect(whatSwitchingDrops([L("rental", "u1")], null, "renovation")).toEqual(["the units"]);
    expect(whatSwitchingDrops([L("supply")], 7, "rental")).toEqual(["the project"]);
    expect(whatSwitchingDrops([L("supply")], 7, "renovation")).toEqual([]);
    expect(whatSwitchingDrops([L("rental", "u1")], null, "rental")).toEqual([]);
  });

  it("a new line takes the unit of the nearest line above that has one", () => {
    expect(nextLineUnit([L("rental", "u1"), L("rental")])).toBe("u1");
    expect(nextLineUnit([L("rental", "u1"), L("rental", "u2")])).toBe("u2");
    expect(nextLineUnit([L("shared")])).toBeNull();
  });
});
