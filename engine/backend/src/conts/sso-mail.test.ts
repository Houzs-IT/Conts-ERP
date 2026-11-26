import { describe, expect, it } from "vitest";
import { mayUseMailCenter } from "./sso";
import type { ContsAccess } from "./access";

// Mail Center re-sync (26 Nov 2026): the sign-on gives a personal mailbox only to people Mail Center opens for, since
// each new address is one more custom address an admin adds in Cloudflare Email Routing.
const FULL_EVERYWHERE: ContsAccess = Object.fromEntries(
  [
    "scSales", "scConsignment", "scProcurement", "scTransportPlan", "scWarehouse", "scInvoices", "serviceCases", "projects",
    "scProduction", "serviceMetrics", "projectDefects", "projectHandover", "projectFinances", "projectSettings",
    "serviceSettings", "serviceMyCases",
  ].map((k) => [k, "full"]),
) as ContsAccess;

describe("mayUseMailCenter", () => {
  it("opens for View, Edit and Full on Mail", () => {
    for (const level of ["view", "edit", "full"] as const) expect(mayUseMailCenter({ scSales: "view", mail: level })).toBe(true);
  });

  it("stays shut with Mail at none or left out, whatever the other areas say", () => {
    expect(mayUseMailCenter({ scSales: "full", mail: "none" })).toBe(false);
    expect(mayUseMailCenter({ projects: "edit" })).toBe(false);
  });

  it("opens for Full everywhere, whose engine role holds every key", () => {
    expect(mayUseMailCenter(FULL_EVERYWHERE)).toBe(true);
  });
});
