import { describe, expect, it } from "vitest";
import { seesProcurement } from "./procurement-visible";

describe("seesProcurement", () => {
  it("the wildcard sees procurement whatever its map says", () => {
    expect(seesProcurement({ permissions: ["*"], page_access: { "scm.procurement": "none" } })).toBe(true);
    expect(seesProcurement({ permissions_set: new Set(["*"]), page_access: { "scm.procurement": "none" } })).toBe(true);
  });
  it("procurement at none hides it", () => {
    expect(seesProcurement({ permissions: ["scm.access"], page_access: { "scm.procurement": "none", "scm.sales.orders": "edit" } })).toBe(false);
  });
  it("a map without the key reads as none", () => {
    expect(seesProcurement({ permissions: [], page_access: { "scm.sales.orders": "edit" } })).toBe(false);
  });
  it("view, or one purchase document page under a none umbrella, shows it", () => {
    expect(seesProcurement({ permissions: [], page_access: { "scm.procurement": "view" } })).toBe(true);
    expect(seesProcurement({ permissions: [], page_access: { "scm.procurement": "none", "scm.procurement.grn": "view" } })).toBe(true);
  });
  it("the catalog page alone does not count as the purchase side", () => {
    expect(seesProcurement({ permissions: [], page_access: { "scm.procurement": "none", "scm.procurement.products": "view" } })).toBe(false);
  });
  it("no page access map at all keeps today's behaviour", () => {
    expect(seesProcurement({ permissions: [] })).toBe(true);
    expect(seesProcurement({ id: 7, permissions: ["scm.access"] })).toBe(true);
    expect(seesProcurement(undefined)).toBe(true);
  });
});
