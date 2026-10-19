import { describe, expect, test } from "vitest";
import { caseCategoryValue, caseProjectOf, parseCaseCategory, projectAddress, projectOptionLabel, type RenoCaseCategory } from "./renovationServiceCaseModel";

const CATS: RenoCaseCategory[] = [
  { code: "BUILTIN", label: "Built-in", subs: [{ code: "WARDROBE", label: "Wardrobe" }] },
  { code: "WORKS", label: "Works", subs: [] },
];

describe("renovation service case: project lookup (owner, 15 Oct 2026)", () => {
  test("a project reads code · name · customer", () => {
    expect(projectOptionLabel({ code: "RN-2610-001", name: "Vista Harmoni B-8-2", customerName: "Tan Ah Kow" })).toBe("RN-2610-001 · Vista Harmoni B-8-2 · Tan Ah Kow");
  });
  test("a project named after its customer does not repeat the name; a missing code is skipped", () => {
    expect(projectOptionLabel({ code: null, name: "Tan Ah Kow", customerName: "Tan Ah Kow" })).toBe("Tan Ah Kow");
  });
  test("the site address: structured lines first, else the old single address", () => {
    expect(projectAddress({ address1: "B-8-2", address2: "", postcode: "56000", city: "KL", state: "WP", siteAddress: "ignored" })).toBe("B-8-2, 56000 KL, WP");
    expect(projectAddress({ address1: "", address2: "", postcode: "", city: "", state: "", siteAddress: "Line 1\nLine 2" })).toBe("Line 1, Line 2");
  });
  test("item category: Category / Sub-category, the category alone, or nothing", () => {
    expect(caseCategoryValue(CATS, "BUILTIN", "WARDROBE")).toBe("Built-in / Wardrobe");
    expect(caseCategoryValue(CATS, "WORKS", "")).toBe("Works");
    expect(caseCategoryValue(CATS, "", "")).toBeNull();
  });
  test("a stored item category reads back as its codes; anything else as none", () => {
    expect(parseCaseCategory(CATS, "Built-in / Wardrobe")).toEqual({ group: "BUILTIN", sub: "WARDROBE" });
    expect(parseCaseCategory(CATS, "Works")).toEqual({ group: "WORKS", sub: "" });
    expect(parseCaseCategory(CATS, "Sofa")).toEqual({ group: "", sub: "" });
    expect(parseCaseCategory(CATS, null)).toEqual({ group: "", sub: "" });
  });
  test("a case row's project link: code · name, or nothing without a project", () => {
    expect(caseProjectOf({ project_id: 7, project_code: "RN-2610-001", project_name: "Vista Harmoni B-8-2" })).toEqual({ id: 7, label: "RN-2610-001 · Vista Harmoni B-8-2" });
    expect(caseProjectOf({ project_id: 7 })).toEqual({ id: 7, label: "Project 7" });
    expect(caseProjectOf({ project_id: null })).toBeNull();
    expect(caseProjectOf(null)).toBeNull();
  });
});
