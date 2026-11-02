import { describe, expect, it } from "vitest";
import { cleanProjectName, contractStatusLabel, projectRows, unitRows, type PickProject } from "./pickerRows";

// The voucher's project and unit pickers (chew 2 Nov 2026; plan 2026-11-02-voucher-purpose Task 3): projects not yet
// done first and newest first, the completed ones after (still pickable), test projects last; search on name, customer
// and code; "SO - " dropped from the name.
const p = (id: number, over: Partial<PickProject> = {}): PickProject => ({
  id, code: `RN-${id}`, name: `PROJECT ${id}`, customer_name: null, contract_status: "RENO_IN_PROGRESS",
  planned_handover_date: null, handed_over_at: null, created_at: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`, done: false, ...over,
});

describe("projectRows", () => {
  it("open newest first, then completed, then test projects", () => {
    const r = projectRows([p(1), p(3, { done: true }), p(2), p(4, { name: "TESTING T-01-01" }), p(5, { name: "DEMO Residence" })], "");
    expect(r.open.map((x) => x.id)).toEqual([2, 1]);
    expect(r.completed.map((x) => x.id)).toEqual([3]);
    expect(r.test.map((x) => x.id)).toEqual([5, 4]);
  });

  it("searches name, customer and code, any case", () => {
    const list = [p(1, { name: "ASTER HILL A-08-11 MS AMANDA", customer_name: "MS AMANDA", code: "RN-2607-003" }), p(2, { name: "BARON C-20-08" })];
    expect(projectRows(list, "amanda").open.map((x) => x.id)).toEqual([1]);
    expect(projectRows(list, "2607").open.map((x) => x.id)).toEqual([1]);
    expect(projectRows(list, "a-08-11").open.map((x) => x.id)).toEqual([1]);
    expect(projectRows(list, "baron").open.map((x) => x.id)).toEqual([2]);
  });

  it("drops a leading SO - from the name", () => {
    expect(cleanProjectName("SO - THE HIPSTER C10-05 MS IRIS")).toBe("THE HIPSTER C10-05 MS IRIS");
    expect(cleanProjectName("so- 18, USJ")).toBe("18, USJ");
    expect(cleanProjectName("ASTER HILL")).toBe("ASTER HILL");
  });

  it("names the contract status", () => {
    expect(contractStatusLabel(p(1, { contract_status: "RENO_CONFIRMED" }))).toBe("Confirmed");
    expect(contractStatusLabel(p(1, { contract_status: "RENO_IN_PROGRESS" }))).toBe("In progress");
    expect(contractStatusLabel(p(1, { contract_status: "RENO_COMPLETED", done: true }))).toBe("Completed");
    expect(contractStatusLabel(p(1, { contract_status: null, handed_over_at: "2026-10-20T04:00:00Z", done: true }))).toBe("Handed over");
    expect(contractStatusLabel(p(1, { contract_status: "CANCELLED", done: true }))).toBe("Cancelled");
    expect(contractStatusLabel(p(1, { contract_status: null }))).toBe("No contract");
  });
});

describe("unitRows", () => {
  it("searches building and number together", () => {
    const units = [{ id: "a", building: "ASTER HILL", unitNumber: "A-3-1" }, { id: "b", building: "BARON", unitNumber: "C-20-08" }];
    expect(unitRows(units, "a-3-1").map((u) => u.id)).toEqual(["a"]);
    expect(unitRows(units, "baron").map((u) => u.id)).toEqual(["b"]);
    expect(unitRows(units, "aster a-3").map((u) => u.id)).toEqual(["a"]);
    expect(unitRows(units, "").map((u) => u.id)).toEqual(["a", "b"]);
  });
});
