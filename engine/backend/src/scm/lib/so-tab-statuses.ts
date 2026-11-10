/* ----------------------------------------------------------------------------
   so-tab-statuses — which sales-order statuses each list TAB covers.

   SHIPPED FOLDS INTO DELIVERED (owner, 2026-08-22): 「Sales Order 的 Shipped 跟
   Delivered 是合起来的」. On the Sales Order the two say the same thing to the
   person reading the list — the goods went out — and the difference between
   "left the building" and "arrived" is what the DELIVERY ORDER is for. Splitting
   it here bought nothing and cost a tab: production carried SHIPPED · 0 against
   DELIVERED · 26 the day of the ruling.

   IT FOLDS PERMANENTLY, and that is why this file exists rather than a line
   deleted from SO_STATUSES. Postgres cannot DROP VALUE, so `SHIPPED` stays a
   legal label in scm.mfg_so_status for ever and a row can still arrive carrying
   it — from the AutoCount mirror, from an older client, from a row written
   before today. Removing it from the vocabulary WITHOUT giving it a bucket sends
   every such row into the list's `other` catch-all: reachable from no tab, and
   subtracted from the count the operator is reading. That is precisely the fault
   `status-counts.ts` was written after — 37 delivery orders invisible while the
   numbers looked settled.

   IT IS DELIBERATELY *NOT* NAMED `*_STATUS_BUCKETS`, and the difference is real
   rather than cosmetic. The four maps that carry that name — DO, PO, GRN, PI —
   are EXHAUSTIVE PARTITIONS of their enum, pinned by
   backend/tests/statusBucketsEnumMembership.test.mjs: every member in exactly
   one bucket, because those four lists have no catch-all and a member with no
   bucket is reachable from no tab at all.

   The Sales Order list is the one that DOES have a catch-all. Its handler
   computes `other = allCount - known` and MfgSalesOrdersListV2 renders an
   "Other" tab whenever that count is non-zero, so a status outside this map is
   still reachable. That is why RETURNED — a legal label in scm.mfg_so_status
   that no column ever stores — needs no entry here, and why registering this map
   as a partition would force a tab nobody asked for.

   CLOSED HAS A TAB AGAIN, and it is NOT folded into anything (2026-08-22). It
   was in the paragraph above, alongside RETURNED, for the day it spent retired.
   It carries a meaning now — stop chasing the remainder, the short-shipment
   case the owner confirmed with 「有的」 — and an order whose remainder was
   abandoned is a different fact from one that was delivered in full. Folding it
   under Delivered would tell the reader the order completed; leaving it to the
   catch-all would file a deliberate decision under "Other". Neither is true, so
   it gets its own tab. See so-lifecycle-guards.ts for the definition.

   SHIPPED is folded anyway rather than left to `other`, and the reason is the
   READER, not reachability: an order whose goods went out belongs under
   Delivered, not under a tab called Other.

   THE KEYS ARE THE WIRE VALUES. `useMfgSalesOrdersPaged` sends
   `status.toUpperCase()`, so the tab `delivered` arrives as `DELIVERED`. A tab
   whose bucket holds one status still reads through here, so there is one place
   that answers "what does this tab select" and no second spelling of it.
   ---------------------------------------------------------------------------- */

export const SO_TAB_STATUSES: Record<string, string[]> = {
  DRAFT:         ['DRAFT'],
  CONFIRMED:     ['CONFIRMED'],
  RENO_CONFIRMED:   ['RENO_CONFIRMED'],
  RENO_IN_PROGRESS: ['RENO_IN_PROGRESS'],
  RENO_COMPLETED:   ['RENO_COMPLETED'],
  IN_PRODUCTION: ['IN_PRODUCTION'],
  READY_TO_SHIP: ['READY_TO_SHIP'],
  DELIVERED:     ['SHIPPED', 'DELIVERED'],
  INVOICED:      ['INVOICED'],
  CLOSED:        ['CLOSED'],
  ON_HOLD:       ['ON_HOLD'],
  CANCELLED:     ['CANCELLED'],
};

/* The desktop list's stage tabs (owner, 6 Nov 2026): All, Draft, Contract, In
   Progress, Completed, Closed, On Hold, Cancelled. A stage holds several exact
   statuses and each row keeps its exact status pill. The map above stays, because
   the phone list still filters and counts one status at a time. */
export const SO_STAGE_TAB_STATUSES: Record<string, string[]> = {
  CONTRACT:    ['CONFIRMED', 'RENO_CONFIRMED'],
  IN_PROGRESS: ['RENO_IN_PROGRESS', 'IN_PRODUCTION', 'READY_TO_SHIP'],
  COMPLETED:   ['RENO_COMPLETED', 'SHIPPED', 'DELIVERED', 'INVOICED'],
};

/** The statuses a tab selects. An unknown tab value selects itself, so a caller
 *  the buckets have never heard of still filters to something real rather than
 *  silently widening to every row. */
export function soStatusesForTab(tab: string): string[] {
  return SO_STAGE_TAB_STATUSES[tab] ?? SO_TAB_STATUSES[tab] ?? [tab];
}

/** Counts per tab, lowercase keys. Every order lands in one exact-status bucket or
 *  in `other`; the stage keys are the same orders summed a second way. */
export function soTabCounts(byStatus: Record<string, number>): Record<string, number> {
  const all = Object.values(byStatus).reduce((s, n) => s + n, 0);
  const counts: Record<string, number> = { all };
  const sum = (members: string[]) => members.reduce((n, m) => n + (byStatus[m] ?? 0), 0);
  let known = 0;
  for (const [tab, members] of Object.entries(SO_TAB_STATUSES)) {
    const n = sum(members);
    counts[tab.toLowerCase()] = n;
    known += n;
  }
  for (const [tab, members] of Object.entries(SO_STAGE_TAB_STATUSES)) counts[tab.toLowerCase()] = sum(members);
  counts.other = all - known;
  return counts;
}
