import { describe, expect, test } from "vitest";
import {
  EMPTY_CUSTOMER_PROPERTY,
  applyLayout,
  fromProject,
  layoutFor,
  mergeProjectIntoSo,
  missingFields,
  showDate,
  toRenovationBlock,
  type LayoutOption,
  type ProjectShared,
} from "./customerPropertyModel";

const LAYOUTS: LayoutOption[] = [
  { id: 1, label: "Studio", bedrooms: 0, bathrooms: 1, sort_order: 10, active: true },
  { id: 2, label: "3 bed 2 bath", bedrooms: 3, bathrooms: 2, sort_order: 40, active: true },
  { id: 3, label: "Old 2+1", bedrooms: 2, bathrooms: 1, sort_order: 50, active: false },
];

const PROJECT: ProjectShared = {
  id: 7, code: "RN-2610-001", name: "Skyline A-12-3", customerName: "Tan Ah Kow", customerPhone: "+60123456789", customerEmail: "",
  siteAddress: "A-12-3 Skyline\nJalan Ampang", building: "Skyline Residence", unitNo: "A-12-3", propertyType: "Condo",
  layoutLabel: "3 bed 2 bath", bedrooms: 3, bathrooms: 2, builtUpSqft: 1100, startDate: "2026-10-20", endDate: null,
};

describe("prefill from a project", () => {
  test("every shared field, numbers as text", () => {
    const v = fromProject(PROJECT);
    expect(v.projectId).toBe(7);
    expect(v.bedrooms).toBe("3");
    expect(v.builtUpSqft).toBe("1100");
    expect(v.customerEmail).toBe("");
  });

  test("picking a project on an SO keeps what the SO typed where the project is blank", () => {
    const typed = { ...EMPTY_CUSTOMER_PROPERTY, customerEmail: "tan@example.com", building: "Typed building" };
    const v = mergeProjectIntoSo(typed, PROJECT);
    expect(v.customerEmail).toBe("tan@example.com");
    expect(v.building).toBe("Skyline Residence");
    expect(v.projectId).toBe(7);
  });
});

describe("layout and counts", () => {
  test("a layout sets its label and both counts; none clears them", () => {
    const v = applyLayout(EMPTY_CUSTOMER_PROPERTY, LAYOUTS[1]);
    expect([v.layoutLabel, v.bedrooms, v.bathrooms]).toEqual(["3 bed 2 bath", "3", "2"]);
    expect(applyLayout(v, null).layoutLabel).toBe("");
  });

  test("the select shows the row the stored values stand for", () => {
    expect(layoutFor({ layoutLabel: "3 bed 2 bath", bedrooms: "3", bathrooms: "2" }, LAYOUTS)?.id).toBe(2);
    expect(layoutFor({ layoutLabel: "", bedrooms: "0", bathrooms: "1" }, LAYOUTS)?.id).toBe(1);
    expect(layoutFor({ layoutLabel: "4 bed 4 bath", bedrooms: "4", bathrooms: "4" }, LAYOUTS)).toBeNull();
  });
});

describe("what is sent and what is missing", () => {
  test("the SO renovation block", () => {
    expect(toRenovationBlock({ ...fromProject(PROJECT), building: " Skyline " })).toEqual({
      projectId: 7, building: "Skyline", unitNo: "A-12-3", propertyType: "Condo", layoutLabel: "3 bed 2 bath",
      bedrooms: "3", bathrooms: "2", builtUpSqft: "1100",
    });
  });

  test("missing and invalid fields ring, same list as the server", () => {
    const m = missingFields({ ...EMPTY_CUSTOMER_PROPERTY, propertyType: "Condo" }, { customerName: "Tan", phone: "", address1: "" });
    expect([...m].sort()).toEqual(["Built-up sq ft", "Delivery address", "Layout", "Phone number"]);
    expect(missingFields(fromProject(PROJECT), { customerName: "Tan", phone: "012", address1: "A-12-3" }).size).toBe(0);
  });

  test("dates read as day month year", () => {
    expect(showDate("2026-10-20")).toBe("20 Oct 2026");
    expect(showDate(null)).toBe("Not set");
  });
});
