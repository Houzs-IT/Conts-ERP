import { describe, expect, it } from "vitest";
import { DEPARTMENT_OPTIONS, departmentLabel, nextLineDepartment } from "./department";

// The department on each ledger line (finance phase 1, spec 3.5): Rental, Supply chain or Shared.
describe("departments", () => {
  it("offers the three, in the menu's words", () => {
    expect(DEPARTMENT_OPTIONS.map((o) => o.label)).toEqual(["Rental", "Supply chain", "Shared"]);
    expect(departmentLabel("supply")).toBe("Supply chain");
    expect(departmentLabel(null)).toBe("Supply chain");
  });

  it("a new line starts with the department of the line above it; the first line starts empty", () => {
    expect(nextLineDepartment([])).toBe("");
    expect(nextLineDepartment([{ department: "rental" }, { department: "" }])).toBe("rental");
    expect(nextLineDepartment([{ department: "rental" }, { department: "shared" }])).toBe("shared");
  });
});
