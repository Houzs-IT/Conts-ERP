import { describe, expect, it } from "vitest";
import { appSurfaceForPath } from "../../routing/appSurface";
import { byArea, byCategory, clientLinkUrl, signedQty } from "./renovationBetaVoPo";

const it_ = (categoryLabel: string, subLabel: string, area: string | null, categorySort = 1, subSort = 1) => ({ categoryLabel, subLabel, area, categorySort, subSort });

describe("byCategory", () => {
  it("groups category then sub-category in catalog order", () => {
    const g = byCategory([it_("Lighting", "Downlight", "Hall", 4), it_("Works", "Paint", null, 1, 2), it_("Works", "Plaster", "Kitchen", 1, 1), it_("Works", "Paint", "Bed 1", 1, 2)]);
    expect(g.map((c) => [c.label, c.count, c.subs.map((s) => `${s.label}:${s.items.length}`)])).toEqual([
      ["Works", 3, ["Plaster:1", "Paint:2"]],
      ["Lighting", 1, ["Downlight:1"]],
    ]);
  });
});

describe("byArea", () => {
  it("sorts areas and puts lines without one last", () => {
    expect(byArea([it_("a", "b", null), it_("a", "b", "Kitchen"), it_("a", "b", "Bath")]).map((g) => g.label)).toEqual(["Bath", "Kitchen", "No area"]);
  });
});

describe("signedQty", () => {
  it("signs quantities and measures", () => {
    expect(signedQty({ qty: 2, measure: null, change: "add" })).toBe("+2");
    expect(signedQty({ qty: -3, measure: null, change: "deduct" })).toBe("-3");
    expect(signedQty({ qty: -1, measure: "12.5 sqft", change: "deduct" })).toBe("-12.5 sqft");
  });
});

describe("client link", () => {
  it("opens outside the login wall", () => {
    const url = clientLinkUrl("https://x.test", "abc.def");
    expect(url).toBe("https://x.test/cpo/abc.def");
    expect(appSurfaceForPath("/cpo/abc.def")).toBe("clientpo");
    expect(appSurfaceForPath("/c/abc")).toBe("contractor");
  });
});
