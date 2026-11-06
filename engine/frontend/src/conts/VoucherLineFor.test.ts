import { describe, expect, it } from "vitest";
import { missingTarget, projectFits, purposeOfNew, purposeOfSaved, purposePayload, repurpose, type PurposeDraft, type SideOf } from "./VoucherLineFor";
import type { SubDepartment } from "./subDepartmentQueries";

// A voucher line names its sub-department (SOP 1.1; chew 4 Nov 2026): Rental (general), Maintenance, Cleaning under
// Rental; Renovation (Dream Crafter) and In-house Reno (The Conts) under Renovation; Company. A renovation one may name
// one of its brand's projects, or none (the brand's own cost); a Rental one a unit, or the company's own Rental project.
const S = (id: string, department: SubDepartment["department"], name: string, fixedKey: SubDepartment["fixedKey"] = null): SubDepartment =>
  ({ id, department, name, fixedKey, staffDepartmentId: null, active: true, sort: 0 });
const SUBS = [
  S("s-gen", "rental", "Rental (general)", "rental_general"), S("s-cln", "rental", "Cleaning"),
  S("s-dc", "supply", "Renovation (Dream Crafter)", "dreamcrafter"), S("s-tc", "supply", "In-house Reno (The Conts)", "theconts"),
  S("s-co", "shared", "Company", "company"),
];
const SIDES: Record<number, ReturnType<SideOf>> = {
  7: { funding: "customer", internalDepartment: null, renoKind: "RENOVATION" },
  8: { funding: "customer", internalDepartment: null, renoKind: "INHOUSE_RENOVATION" },
  9: { funding: "internal", internalDepartment: "rental", renoKind: "RENOVATION" },
};
const sideOf: SideOf = (id) => (id == null ? null : SIDES[id] ?? null);
const blank = (): PurposeDraft => purposeOfNew([]);

describe("a line's sub-department", () => {
  it("a new voucher's first line has none and must be chosen", () => {
    expect(blank()).toMatchObject({ subDepartmentId: null });
    expect(missingTarget([{ ...blank(), n: 1 }])).toEqual({ title: "Pick the department", body: "Line 1: pick its department." });
  });

  it("choosing one sets the department", () => {
    expect(repurpose(blank(), { subDepartmentId: "s-cln" }, sideOf, SUBS)).toMatchObject({ subDepartmentId: "s-cln", department: "rental", lineFor: "unit" });
    expect(repurpose(blank(), { subDepartmentId: "s-tc" }, sideOf, SUBS)).toMatchObject({ department: "supply", lineFor: "project", projectId: null });
    expect(repurpose(blank(), { subDepartmentId: "s-co" }, sideOf, SUBS)).toMatchObject({ department: "shared", lineFor: "company" });
  });

  it("a renovation line needs no project", () => {
    const l = repurpose(blank(), { subDepartmentId: "s-tc" }, sideOf, SUBS);
    expect(missingTarget([{ ...l, n: 1 }])).toBeNull();
    expect(purposePayload(l, null)).toEqual({ department: "supply", subDepartmentId: "s-tc", unitId: null, projectId: null });
  });

  it("only the brand's own projects fit; a Rental line takes the company's own Rental project", () => {
    expect(projectFits(SUBS[3]!, SIDES[8]!)).toBe(true);
    expect(projectFits(SUBS[3]!, SIDES[7]!)).toBe(false);
    expect(projectFits(SUBS[2]!, SIDES[7]!)).toBe(true);
    expect(projectFits(SUBS[2]!, SIDES[9]!)).toBe(false);
    expect(projectFits(SUBS[0]!, SIDES[9]!)).toBe(true);
    expect(projectFits(SUBS[0]!, SIDES[7]!)).toBe(false);
    expect(projectFits(SUBS[4]!, SIDES[7]!)).toBe(false);
  });

  it("switching to another sub-department drops a project or unit that no longer fits", () => {
    const tc = repurpose(repurpose(blank(), { subDepartmentId: "s-tc" }, sideOf, SUBS), { projectId: 8 }, sideOf, SUBS);
    expect(tc).toMatchObject({ projectId: 8, lineFor: "project" });
    expect(repurpose(tc, { subDepartmentId: "s-dc" }, sideOf, SUBS)).toMatchObject({ projectId: null, department: "supply" });
    const cln = repurpose(repurpose(blank(), { subDepartmentId: "s-cln" }, sideOf, SUBS), { unitId: "u-a31" }, sideOf, SUBS);
    expect(repurpose(cln, { subDepartmentId: "s-gen" }, sideOf, SUBS)).toMatchObject({ unitId: "u-a31", lineFor: "unit" });
    expect(repurpose(cln, { subDepartmentId: "s-tc" }, sideOf, SUBS)).toMatchObject({ unitId: null });
  });

  it("on a Rental line a unit and a project exclude each other", () => {
    const gen = repurpose(blank(), { subDepartmentId: "s-gen" }, sideOf, SUBS);
    const withProject = repurpose(repurpose(gen, { unitId: "u-a31" }, sideOf, SUBS), { projectId: 9 }, sideOf, SUBS);
    expect(withProject).toMatchObject({ unitId: null, projectId: 9, lineFor: "project", department: "rental" });
    expect(repurpose(withProject, { unitId: "u-a31" }, sideOf, SUBS)).toMatchObject({ unitId: "u-a31", projectId: null, lineFor: "unit" });
  });

  it("a new line copies the line above's sub-department, unit and project", () => {
    const above = repurpose(repurpose(blank(), { subDepartmentId: "s-cln" }, sideOf, SUBS), { unitId: "u-a31" }, sideOf, SUBS);
    expect(purposeOfNew([above])).toMatchObject({ subDepartmentId: "s-cln", department: "rental", unitId: "u-a31" });
  });

  it("an older line without one, once edited, keeps its For and is not forced to pick", () => {
    const old = purposeOfSaved({ department: "rental", unitId: "u-a31", projectId: null, subDepartmentId: null });
    const edited = repurpose(old, { unitId: null }, sideOf, SUBS);
    expect(edited.saved).toBeUndefined();
    expect(missingTarget([{ ...edited, n: 1 }])).toBeNull();
    expect(purposePayload(edited, null)).toEqual({ department: "rental", unitId: null, projectId: null });
  });

  it("a saved line goes back exactly as it was, sub-department included; an older one without one is not forced", () => {
    const old = purposeOfSaved({ department: "supply", unitId: null, projectId: 7, subDepartmentId: null });
    expect(missingTarget([{ ...old, n: 1 }])).toBeNull();
    expect(purposePayload(old, null)).toEqual({ department: "supply", unitId: null, projectId: 7 });
    const mine = purposeOfSaved({ department: "rental", unitId: "u-a31", projectId: null, subDepartmentId: "s-cln" });
    expect(purposePayload(mine, null)).toEqual({ department: "rental", subDepartmentId: "s-cln", unitId: "u-a31", projectId: null });
    expect(mine.subDepartmentId).toBe("s-cln");
  });
});
