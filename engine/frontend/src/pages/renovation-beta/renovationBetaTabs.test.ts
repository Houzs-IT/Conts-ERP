import { describe, expect, it } from "vitest";
import { BETA_TABS, tabFromParam } from "./renovationBetaTabs";

describe("tabFromParam", () => {
  it("opens the named tab", () => {
    expect(tabFromParam("defects")).toBe("defects");
    expect(tabFromParam("client-po")).toBe("client-po");
  });
  it("falls back to Overview for a missing or unknown tab", () => {
    expect(tabFromParam(null)).toBe("overview");
    expect(tabFromParam("")).toBe("overview");
    expect(tabFromParam("payments")).toBe("overview");
  });
  it("keeps the mockup's tab order", () => {
    expect(BETA_TABS.map((t) => t.label)).toEqual(["Overview", "Drawings", "VO", "PO", "Client PO", "DO", "GR", "Site & photos", "Defects", "Timeline"]);
  });
});
