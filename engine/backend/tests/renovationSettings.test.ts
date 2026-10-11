import { describe, expect, test } from "vitest";
import {
  addDays, autoProjectName, cleanBuilding, cleanContractor, cleanPropertyType, cleanSlaDays, contractorSupplierCode, slaOf,
} from "../src/services/renovation/projectSettings";
import { validateCreate } from "../src/services/renovation/create";
import { redFlags } from "../src/services/renovation/redFlags";

const TODAY = "2026-10-11";

describe("project name", () => {
  test("<BUILDING> <UNIT> <CUSTOMER> in capitals, like the Notion titles", () => {
    expect(autoProjectName("Baron", " C-20-08 ", "Mr  Albert")).toBe("BARON C-20-08 MR ALBERT");
    expect(autoProjectName("D'CLOVER", null, "ms farah")).toBe("D'CLOVER MS FARAH");
    expect(autoProjectName(null, "", undefined)).toBe("");
  });
});

describe("SLA due date", () => {
  test("start + the type's SLA days; days left counts down; overdue only before handover", () => {
    expect(addDays("2026-10-11", 45)).toBe("2026-11-25");
    expect(slaOf({ startDate: "2026-10-11", createdAt: null, slaDays: 45, handedOver: false, today: TODAY }))
      .toEqual({ startDate: "2026-10-11", days: 45, dueDate: "2026-11-25", daysLeft: 45, overdue: false });
    const late = slaOf({ startDate: "2026-08-01", createdAt: null, slaDays: 21, handedOver: false, today: TODAY });
    expect(late).toMatchObject({ dueDate: "2026-08-22", overdue: true });
    expect(late!.daysLeft).toBeLessThan(0);
    expect(slaOf({ startDate: "2026-08-01", createdAt: null, slaDays: 21, handedOver: true, today: TODAY })!.overdue).toBe(false);
  });
  test("no start date: the day it was created, in Malaysia time", () => {
    // 2026-10-10 17:30 UTC is 11 Oct 01:30 in Kuala Lumpur
    expect(slaOf({ startDate: null, createdAt: "2026-10-10T17:30:00Z", slaDays: 14, handedOver: false, today: TODAY })!.startDate).toBe("2026-10-11");
  });
  test("a type without SLA days has no SLA", () => {
    expect(slaOf({ startDate: TODAY, createdAt: null, slaDays: null, handedOver: false, today: TODAY })).toBeNull();
    expect(slaOf({ startDate: null, createdAt: null, slaDays: 30, handedOver: false, today: TODAY })).toBeNull();
  });
  test("a passed SLA is a red flag", () => {
    const base = { today: TODAY, views: [], taskStatuses: [], prompts: [], billingAvailable: true, hasSo: false, openSnags: [], plannedHandoverDate: null, handedOver: false, gateOpen: true };
    expect(redFlags({ ...base, slaOverdueSince: "2026-10-01" })).toEqual([{ code: "sla_overdue", text: "SLA due date passed (2026-10-01)" }]);
    expect(redFlags(base)).toEqual([]);
  });
  test("SLA days are whole days from 1 to 3650, or blank", () => {
    expect(cleanSlaDays(45)).toEqual({ ok: true, value: 45 });
    expect(cleanSlaDays("")).toEqual({ ok: true, value: null });
    expect(cleanSlaDays(0)).toMatchObject({ ok: false, error: "sla_days_invalid" });
    expect(cleanSlaDays(2.5)).toMatchObject({ ok: false });
  });
});

describe("new project: required set", () => {
  const ok = { customerName: "MR ALBERT", buildingId: 8, unitNo: "C-20-08", salesPersonId: 1, projectTypeId: 1, brandId: 3 };
  test("customer, building, unit, sales person, type and brand; no name needed", () => {
    expect(validateCreate(ok)).toBeNull();
    expect(validateCreate({ ...ok, customerName: " " })).toBe("customer_required");
    expect(validateCreate({ ...ok, buildingId: null })).toBe("building_required");
    expect(validateCreate({ ...ok, unitNo: "" })).toBe("unit_required");
    expect(validateCreate({ ...ok, salesPersonId: undefined })).toBe("sales_required");
    expect(validateCreate({ ...ok, projectTypeId: 0 })).toBe("type_required");
    expect(validateCreate({ ...ok, brandId: null })).toBe("brand_required");
  });
  test("optional fields are checked only when given", () => {
    expect(validateCreate({ ...ok, bedrooms: 3, bathrooms: 2, builtUpSqft: 850.5, propertyTypeId: 1, designerPersonId: 4, customerPhone: "0123" })).toBeNull();
    expect(validateCreate({ ...ok, bedrooms: -1 })).toBe("rooms_invalid");
    expect(validateCreate({ ...ok, bathrooms: 1.5 })).toBe("rooms_invalid");
    expect(validateCreate({ ...ok, builtUpSqft: 0 })).toBe("size_invalid");
    expect(validateCreate({ ...ok, propertyTypeId: "x" as unknown as number })).toBe("property_type_invalid");
    expect(validateCreate({ ...ok, designerPersonId: -2 })).toBe("person_invalid");
  });
});

describe("settings lists", () => {
  test("a building needs a name, kept in capitals; state and property type optional", () => {
    expect(cleanBuilding({ name: " sky  park ", state: "Selangor", propertyTypeId: 2 })).toEqual({ ok: true, value: { name: "SKY PARK", state: "Selangor", propertyTypeId: 2 } });
    expect(cleanBuilding({ name: "" })).toMatchObject({ ok: false, error: "name_required" });
    expect(cleanBuilding({ name: "X", propertyTypeId: "abc" })).toMatchObject({ ok: false, error: "property_type_invalid" });
    expect(cleanBuilding({ state: "" }, true)).toEqual({ ok: true, value: { state: null } });
  });
  test("a property type needs a name", () => {
    expect(cleanPropertyType({ name: "Townhouse" })).toEqual({ ok: true, value: { name: "Townhouse" } });
    expect(cleanPropertyType({ name: " " })).toMatchObject({ ok: false });
    expect(cleanPropertyType({ active: false }, true)).toEqual({ ok: true, value: { active: false } });
  });
  test("a contractor: name in capitals, trade, and optionally the existing supplier it is", () => {
    expect(cleanContractor({ name: "little builder", trade: "Kitchen top" })).toEqual({ ok: true, value: { name: "LITTLE BUILDER", trade: "Kitchen top" } });
    expect(cleanContractor({ name: "X", supplierId: "not-a-uuid" })).toMatchObject({ ok: false, error: "supplier_invalid" });
    expect(contractorSupplierCode("Eleganz- Tim")).toBe("SC-ELEGANZ-TIM");
    expect(contractorSupplierCode("KIM SENG")).toBe("SC-KIM-SENG");
  });
});
