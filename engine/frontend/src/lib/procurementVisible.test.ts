import { describe, expect, it } from "vitest";
import { seesProcurement } from "./procurementVisible";

describe("seesProcurement", () => {
  it("the owner's wildcard sees everything", () => {
    expect(seesProcurement({ permissions: ["*"], page_access: { "scm.procurement": "none" } })).toBe(true);
  });
  it("a salesperson with procurement at none sees nothing of it", () => {
    expect(seesProcurement({ permissions: ["scm.sales.orders"], page_access: { "scm.procurement": "none", "scm.sales.orders": "edit" } })).toBe(false);
  });
  it("a missing procurement key in a map reads as none", () => {
    expect(seesProcurement({ permissions: [], page_access: { "scm.sales.orders": "edit" } })).toBe(false);
  });
  it("view, or one purchase document page, is enough", () => {
    expect(seesProcurement({ permissions: [], page_access: { "scm.procurement": "view" } })).toBe(true);
    expect(seesProcurement({ permissions: [], page_access: { "scm.procurement": "none", "scm.procurement.po": "edit" } })).toBe(true);
  });
  it("an account with no page access map keeps today's behaviour", () => {
    expect(seesProcurement({ permissions: [] })).toBe(true);
    expect(seesProcurement(null)).toBe(true);
  });
});
