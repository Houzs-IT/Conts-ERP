import { describe, expect, it } from "vitest";
import { contsNavOnly, isContsHiddenPath } from "./navOnly";

// Owner decision C7 (11 Oct 2026): Conts does not use the accounting ledger, consignment, HR
// commission, POS or AutoCount. Their menus go, and their addresses open the home page.
describe("Conts switched-off modules", () => {
  it("matches the module addresses, with or without a query, and nothing that merely shares a prefix", () => {
    for (const p of ["/scm/accounting", "/scm/accounting?tab=gl", "/scm/chart-of-accounts", "/scm/consignment-notes/abc",
      "/scm/purchase-consignment-orders/new", "/scm/hr/commission", "/autocount-sync", "/scm/forecast"]) {
      expect(isContsHiddenPath(p)).toBe(true);
    }
    for (const p of ["/scm/sales-orders", "/scm/credit-notes", "/scm/outstanding", "/scm/accounting-extra", "/scm/finance", "/", ""]) {
      expect(isContsHiddenPath(p)).toBe(false);
    }
  });

  it("prunes hidden entries at every depth and drops a group left empty", () => {
    const tabs = [
      { label: "Finance", to: "/scm/finance", children: [
        { label: "Money in", children: [{ label: "Credit Notes", to: "/scm/credit-notes" }] },
        { label: "Books", children: [{ label: "General Ledger", to: "/scm/accounting?tab=gl" }] },
      ] },
      { label: "Supply Chain", to: "/scm", children: [
        { label: "Consignment", to: "/scm/consignment", children: [{ label: "Consignment Note", to: "/scm/consignment-notes" }] },
        { label: "Sales Orders", to: "/scm/sales-orders" },
      ] },
      { label: "HR", to: "/scm/hr/commission" },
    ];
    const out = contsNavOnly(tabs);
    expect(out.map((t) => t.label)).toEqual(["Finance", "Supply Chain"]);
    expect(out[0].children?.map((c) => c.label)).toEqual(["Money in"]);
    expect(out[1].children?.map((c) => c.label)).toEqual(["Sales Orders"]);
  });

  it("the real menu carries no switched-off link", async () => {
    const { NAV_TABS } = await import("../components/Sidebar");
    type Node = { to?: string; children?: Node[] };
    const links: string[] = [];
    const walk = (ts: Node[]) => ts.forEach((t) => { if (t.to) links.push(t.to); if (t.children) walk(t.children); });
    walk(NAV_TABS);
    expect(links.length).toBeGreaterThan(5);
    expect(links.filter((l) => isContsHiddenPath(l))).toEqual([]);
    expect(links).toContain("/scm/credit-notes");
  });
});
