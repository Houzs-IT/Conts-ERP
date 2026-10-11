import { describe, expect, test } from "vitest";
import { missingFields, newProjectBody, type NewProjectForm } from "./CreateRenovationPanel";
import { autoProjectName, defaultBrandId } from "./settingsApi";

const filled: NewProjectForm = {
  customerName: "Mr Albert", customerPhone: "", buildingId: 8, state: "", unitNo: "C-20-08", salesPersonId: 1, projectTypeId: 1,
  brandId: 3, propertyTypeId: null, bedrooms: "", bathrooms: "", builtUpSqft: "", designerPersonId: null, notes: "",
};

describe("new renovation project form", () => {
  test("the required set: customer, building, unit, sales person, type, brand", () => {
    expect(missingFields(filled)).toEqual([]);
    expect(missingFields({ ...filled, customerName: " ", buildingId: null, unitNo: "", salesPersonId: null, projectTypeId: null, brandId: null }))
      .toEqual(["customer name", "building", "unit no", "sales person", "project type", "brand"]);
  });
  test("optional numbers must be numbers when typed", () => {
    expect(missingFields({ ...filled, bedrooms: "3", bathrooms: "2", builtUpSqft: "850" })).toEqual([]);
    expect(missingFields({ ...filled, bedrooms: "three", builtUpSqft: "0" })).toEqual(["bedrooms (a whole number)", "built-up size (a number above 0)"]);
  });
  test("the body sends no name, no dates, blanks as null", () => {
    const b = newProjectBody({ ...filled, bedrooms: "3", notes: "  " });
    expect(b).toMatchObject({ customerKind: "customer", customerName: "Mr Albert", buildingId: 8, unitNo: "C-20-08", bedrooms: 3, bathrooms: null, notes: null, customerPhone: null });
    expect(b).not.toHaveProperty("name");
    expect(b).not.toHaveProperty("plannedHandoverDate");
  });
  test("the name it will get, and the default brand", () => {
    expect(autoProjectName("BARON", "c-20-08", "mr albert")).toBe("BARON C-20-08 MR ALBERT");
    expect(defaultBrandId([{ id: 1, name: "The Conts", color: null, active: true }, { id: 2, name: "Dream Crafter", color: null, active: true }])).toBe(2);
    expect(defaultBrandId([{ id: 1, name: "The Conts", color: null, active: true }])).toBe(1);
    expect(defaultBrandId([])).toBeNull();
  });
});
