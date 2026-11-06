import { describe, expect, test } from "vitest";
import { SO_STAGE_TAB_STATUSES, SO_TAB_STATUSES, soStatusesForTab, soTabCounts } from "./so-tab-statuses";

describe("SO_TAB_STATUSES", () => {
  /* THE RULING THIS FILE EXISTS FOR (owner, 2026-08-22):
     「Sales Order 的 Shipped 跟 Delivered 是合起来的」. */
  test("the Delivered tab covers SHIPPED as well as DELIVERED", () => {
    expect(soStatusesForTab("DELIVERED")).toEqual(["SHIPPED", "DELIVERED"]);
  });

  /* THE BUG THIS PREVENTS. Deleting SHIPPED from the vocabulary WITHOUT giving
     it a bucket sends a row carrying it into the list's `other` catch-all —
     reachable from no tab, and subtracted from the count the operator reads.
     That is the fault status-counts.ts was written after: 37 delivery orders
     invisible while the numbers looked settled. */
  test("SHIPPED is reachable from a tab and is in exactly one", () => {
    const owners = Object.entries(SO_TAB_STATUSES)
      .filter(([, members]) => members.includes("SHIPPED"))
      .map(([tab]) => tab);
    expect(owners).toEqual(["DELIVERED"]);
  });

  test("no status is claimed by two tabs", () => {
    const seen = new Map<string, string>();
    for (const [tab, members] of Object.entries(SO_TAB_STATUSES)) {
      for (const m of members) {
        expect(seen.has(m), `${m} is in both ${seen.get(m)} and ${tab}`).toBe(false);
        seen.set(m, tab);
      }
    }
  });

  test("there is no Shipped tab left to select", () => {
    expect(SO_TAB_STATUSES.SHIPPED).toBeUndefined();
  });

  /* CLOSED came BACK on 2026-08-22 with a meaning the retired one never had —
     "stop chasing the remainder" — so it needs a tab of its own. It is not
     folded into anything: an order whose remainder was abandoned is a different
     fact from one that was delivered in full, and the person reading the list
     is the one who has to tell them apart.

     Asserted on the MAP and not only through `soStatusesForTab`, because the
     unknown-tab fall-through answers `["CLOSED"]` for a tab that does not exist
     — so the round-trip alone would pass on a tree with no Closed tab, and the
     count the operator reads comes from the map, not from the fall-through. */
  test("Closed is its own tab and covers only CLOSED", () => {
    expect(SO_TAB_STATUSES.CLOSED).toEqual(["CLOSED"]);
    expect(soStatusesForTab("CLOSED")).toEqual(["CLOSED"]);
  });

  /* The wire sends `status.toUpperCase()` (sales-order-queries.ts), so the keys
     must be the values that actually arrive. */
  test("every key is upper case, matching what the client sends", () => {
    for (const tab of Object.keys(SO_TAB_STATUSES)) expect(tab).toBe(tab.toUpperCase());
  });

  test("a single-status tab still answers through the buckets", () => {
    expect(soStatusesForTab("DRAFT")).toEqual(["DRAFT"]);
    expect(soStatusesForTab("ON_HOLD")).toEqual(["ON_HOLD"]);
  });

  /* An unknown tab must filter to SOMETHING real. Returning [] would widen the
     query to every row, which is the opposite of what a filter is for. */
  test("an unknown tab selects itself rather than widening to everything", () => {
    expect(soStatusesForTab("WAT")).toEqual(["WAT"]);
    expect(soStatusesForTab("WAT")).not.toHaveLength(0);
  });

  /* The desktop stage tabs (owner, 6 Nov 2026). */
  test("the stage tabs select the statuses the owner listed", () => {
    expect(soStatusesForTab("CONTRACT")).toEqual(["CONFIRMED", "RENO_CONFIRMED"]);
    expect(soStatusesForTab("IN_PROGRESS")).toEqual(["RENO_IN_PROGRESS", "IN_PRODUCTION", "READY_TO_SHIP"]);
    expect(soStatusesForTab("COMPLETED")).toEqual(["RENO_COMPLETED", "SHIPPED", "DELIVERED", "INVOICED"]);
  });

  test("the phone's exact-status filters still work", () => {
    expect(soStatusesForTab("CONFIRMED")).toEqual(["CONFIRMED"]);
    expect(soStatusesForTab("RENO_CONFIRMED")).toEqual(["RENO_CONFIRMED"]);
  });

  test("no status sits in two stage tabs", () => {
    const flat = Object.values(SO_STAGE_TAB_STATUSES).flat();
    expect(new Set(flat).size).toBe(flat.length);
  });

  test("the tabs add up to All, an unknown spelling included", () => {
    const c = soTabCounts({
      DRAFT: 1, CONFIRMED: 2, RENO_CONFIRMED: 3, RENO_IN_PROGRESS: 4, IN_PRODUCTION: 5, READY_TO_SHIP: 6,
      RENO_COMPLETED: 7, SHIPPED: 8, DELIVERED: 9, INVOICED: 10, CLOSED: 11, ON_HOLD: 12, CANCELLED: 13, WAT: 14,
    });
    expect(c.all).toBe(105);
    expect(c.contract).toBe(5);
    expect(c.in_progress).toBe(15);
    expect(c.completed).toBe(34);
    expect(c.other).toBe(14);
    expect(c.draft + c.contract + c.in_progress + c.completed + c.closed + c.on_hold + c.cancelled + c.other).toBe(c.all);
  });

  test("the phone's exact-status counts are still sent", () => {
    const c = soTabCounts({ CONFIRMED: 2, SHIPPED: 1, DELIVERED: 1 });
    expect(c.confirmed).toBe(2);
    expect(c.delivered).toBe(2);
  });
});
