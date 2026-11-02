import { describe, expect, it } from "vitest";
import { TAG, departmentOf, lineForOf, nextLine, switchLine } from "./voucherPurpose";

// Each payment voucher line says what it is for (chew 2 Nov 2026; plan 2026-11-02-voucher-line-purpose Task 2): a unit
// (Rental), a project (its department follows the project) or the company. There is no voucher-wide For any more.
const L = (department: "" | "rental" | "supply" | "shared", unitId: string | null = null, projectId: number | null = null) => ({ department, unitId, projectId });
const customer = { funding: "customer", internalDepartment: null };
const ownRental = { funding: "internal", internalDepartment: "rental" };
const ownShowroom = { funding: "internal", internalDepartment: "supply" };

describe("each line's For", () => {
  it("the department follows the For and the project", () => {
    expect(departmentOf("unit")).toBe("rental");
    expect(departmentOf("company")).toBe("shared");
    expect(departmentOf("project", customer)).toBe("supply");
    expect(departmentOf("project", ownRental)).toBe("rental");
    expect(departmentOf("project", ownShowroom)).toBe("supply");
    expect(departmentOf("project", null)).toBe("supply");
  });

  it("an older voucher's line reads as Unit, Project or Company", () => {
    expect(lineForOf(L("rental", "u1"))).toBe("unit");
    expect(lineForOf(L("supply", null, 7))).toBe("project");
    expect(lineForOf(L("rental", null, 8))).toBe("project");
    expect(lineForOf(L("shared"))).toBe("company");
    expect(lineForOf(L("rental"))).toBe("unit");
    expect(lineForOf(L("supply"))).toBe("project");
  });

  it("switching drops what no longer applies", () => {
    expect(switchLine({ ...L("rental", "u1"), note: "x" }, "project")).toEqual({ ...L("rental"), note: "x" });
    expect(switchLine(L("supply", null, 7), "company")).toEqual(L("supply"));
    expect(switchLine(L("supply", null, 7), "unit")).toEqual(L("supply"));
    expect(switchLine(L("rental", "u1"), "unit")).toEqual(L("rental", "u1"));
  });

  it("a new line copies the line above; the first starts on Company", () => {
    expect(nextLine([])).toEqual({ for: "company", unitId: null, projectId: null });
    expect(nextLine([L("rental", "u1")])).toEqual({ for: "unit", unitId: "u1", projectId: null });
    expect(nextLine([L("rental", "u1"), L("supply", null, 7)])).toEqual({ for: "project", unitId: null, projectId: 7 });
  });

  it("tags read Rental, Renovation, Company", () => {
    expect([TAG.rental, TAG.supply, TAG.shared]).toEqual(["Rental", "Renovation", "Company"]);
  });
});
