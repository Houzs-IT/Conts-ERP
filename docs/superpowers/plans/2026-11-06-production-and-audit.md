# Production Order rebuild and transaction-flow audit fixes (6 Nov 2026)

Design: https://claude.ai/artifact/X1A1GWpqLePtEHgYHPSCgp (local copies of the boards are the `*.dc.html` files in the
session scratchpad `podesign/project/`). Boards: List, Main, Phone, PhonePending, Long, Composition, Actions,
Project, Maintenance, SalesOrders, Vo, Documents, SoMaintenance, MaintenanceJobs.

Everything is built and tried on localhost first. Nothing merges until the owner has tried it. Keep Houzs-only paths working.
Owner rule: change only what he named. Keep existing screens, tabs and headers unless listed here.

## Owner rulings

Stock
- Production Order: stock, raw materials included, leaves when Start is pressed. Supplier PO and normal stock leave at DO.
- Start does not wait for all materials. Everything ready: starts at once, no pop-up. Something not ready: one short
  reminder, Start anyway. A shortfall still deducts, so stock may go negative until goods arrive.
- Stock quantities are whole numbers: a fractional need rounds UP at Start (12.5 issues 13); leftovers use Return stock.
  The owner has not yet answered this; it is the recommended default.
- After Start: Request more (extra material, lands on the order's raw materials and shows Short until bought) and
  Return stock (used less; picks the warehouse from a dropdown). Before Start: Add raw material.
- Pooled stock across warehouses (memory conts-warehouse-rule). MRP's warehouse filter must not create false shortages.

Dates and hours
- Order carries document date, plan start, plan finish, actual start, actual finish. Plan dates exist on the order;
  actual dates come from Start and Complete; Schedule (days) is worked out. Sundays and public holidays do not count.
- Production Time is hours, typed by hand, management's budget. Production Hours are clocked hours; the link from
  attendance to orders is LATER. Days and hours are never converted.
- Worker: Assign (manual) or whoever presses Start. No claim button.

Progress
- No Mark progress and no percentages. Daily photo upload is the record. Progress reads Day N of M from the plan dates.
  A day strip (Day 1..N, one line) shows one day's photos; it pages or scrolls when long; a day with none says No photos.
- Overdue: past plan finish and not completed. List gets Overdue tab and card.

Flow
- Complete is one press, no pop-up, a message confirms. GR and DO show ready. Project shows the work done. All order
  photos go to GR, DO and Project. DO is POD and has no day grouping.
- Production Order is the truth for Works; project tasks follow it.
- SO, PO and Production Order may all change after Start. Workers see a notice at the top (New change from VO-01).
- Works lines come from the PO: no Edit SKU on the Production Order. Add line stays.
- Transfer from Sales Order stays, and it raises an in-house PO in between so every order has a PO.
- A PO belongs to one SO for Works and Built-in. One SO may have many POs (several suppliers, or one supplier one PO).
  Other categories keep bulk purchase in MRP.
- Not now: rework, trade order checks, labour cost into Project, clock-in link.

Screens
- Production Orders list: all existing columns stay; add Plan Start, Plan Finish, Status, Progress, Assigned To. Tabs:
  All, Draft, Pending (replaces Outstanding), In Progress, Overdue, On Hold, Completed, Cancelled. Dropdown keeps its
  line table and adds Raw material, Needed, Stock, Warehouse, PO, Arrives.
- Detail: Main board. Phone: Phone and PhonePending boards. Right column stays as it is, Key dates as drawn.
- SKU Composition: owner's structure (cards, pills, table, right drawer), tidier only.
- All projects: same page, add default columns Step, PIC, Salesperson, Handover, VO.
- Project Maintenance: same long page. Replace Switch off with an In use toggle; rows editable; Add at the bottom.
- Sales Orders: tabs All, Draft, Contract, In Progress, Completed, Closed, then On Hold, Cancelled; server buckets add up to All.
- VO: columns What changed, Net, Contract before to after, PO impact; open a row for Added, Changed, Removed with Before, After, Amount.
- Delivery Orders: keep Draft; add type tabs Works POD, Furniture and Built-in, Loose items.
- Sales Invoices: show a Draft tab; show Bills for (instalment). Delivery Returns: add Draft; add Why and What happens.
- Sales Order Maintenance: same collapsible sections, tidied. The Conts Maintenance: filters become one row of dropdowns with chips.

## Audit findings to fix (code reading, reproduce before fixing)

Stock and flow
1. Raw material never leaves stock (`production-orders.ts` Complete). Fixed by Start.
2. Received units count twice (`mrp.ts:307,1424`). Demand minus received, while received stays in stock.
3. Split on-site delivery receives twice (`onsite-twin.ts:113`). Twin repeats on Delivered; no lock or `onsite_twins` check; draft DOs ignored.
4. Retry hides a failed stock move (`production-orders.ts:1219-1221`, `onsite-twin.ts:93,133`).
5. Two customers on one in-house PO jam Complete (`mixed_customers`). MRP Combined must split Works and Built-in by SO.
6. Works plus Built-in in Combined leaves an empty PO and order (`po-grouping.ts:31`).
7. Order without a source PO gets no GR. Fixed by Transfer raising a PO.
8. GR uses PO lines, DO uses order lines. PO changes never reach the order (`0208` insert-only triggers).
9. Materials copied once on insert (`0223`): later qty edits, deletions and composition edits do not reach them; saved lists
   repeat on partial POs and are not scaled; measured lines give qty 1.
10. Line edits have no status guard (`production-orders.ts:920,964,1021`).
11. Partly completed order can be cancelled; cancel leaves its PO open; `production_sync_po` can revive it.
12. MRP warehouse filter breaks pooling (`mrp.ts:652,1124,1273`, `inventory.ts:1663`).
13. Pooled allocation can make a real shortage unbuyable (`mrp.ts:1435`, `production-orders.ts:495`).
14. Changing one material's warehouse rewrites the order's location (`mrp.ts:2051`).
15. ETA from the pool, PO number from the order (`production-orders.ts:694`). Completed, held and draft orders report wrong state.
16. Held SOs still drive shortage (`mrp.ts:~838`).
17. Twin only fires from two frontend hooks; phone confirm, planning convert and site receipt raise no partner.
18. Delivery return warehouse differs from the DO's (`delivery-returns.ts:233`).
19. GRN confirm race (`grns.ts:1957,441`): second caller passes the swap. `/onsite-twin` has no area guard (`scm/index.ts:370`).
20. Complete bypasses area gates (`production-orders.ts:1194`). Production prices reach Procurement viewers (`:83,544`).
21. DO status write has no status check (`delivery-orders-mfg.ts:5374`); failed cancel reversal cannot retry (`:5198`).

SO and VO
22. VO ignores delivered and received qty (`renovation-vo.ts` applyVo, quickVo). Flag only, no `po_amendments`; AMEND qty wrong for split lines (`:291`).
23. Desktop has no PO flags, Create PO, contract status (`App.tsx:926`, `BetaPoTab.tsx:318`).
24. Contract cancel fails after approvals (`SalesOrderDetail.tsx:2025`, `MobileSODetail.tsx:874`) and checks only PO lines (`renovation-so.ts:404`).
25. MRP ignores contract line settings (`mrp.ts:1476`, `Mrp.tsx:581`). `raisePos` skips No PO, warehouses, in-house instalments (`renovation-po-split.ts:147,206`).
26. Phone cannot edit a contract (`MobileNewSO.tsx:624`). Changed options do not reach order lines.
27. `/production-orders/from-sos` has no guards (`production-orders.ts:789,752`).

Money
28. Invoice from DO skips the renovation refusal (`si-from-do.ts:342`, `auto-final-invoice.ts:75`).
29. Cancelled instalment stays billed (`renovation-billing.ts:161,191`). VO after the last instalment cannot bill.
30. Waived negative line stops journals (`reno-waterfall.ts:57`). Credit notes carry no invoice id (`renovation-billing.ts:240,320`).
31. `billingView.receivedSen` ignores order payments (`renovation-billing.ts:162`). PO schedule posts no journal and ignores amendments (`PoPaymentScheduleCard.tsx:25`).
32. `/mfg-sales-orders/:docNo/money/refund` reaches the voucher core on Sales edit alone (`mfg-sales-orders.ts:1530`). Refund after a credit.
33. Project limit adds order and invoice instead of max (`project-limit.ts:142`). Project page sends no `confirmCreditNote` (`RenovationDetail.tsx:180`).

Houzs leftovers: CORS origins (`index.ts:218`), `MobileProfile.tsx:865`, `PortalFrame.tsx:76,90`, `so-branding-label.ts`.
Test failures to look at: documentRefs, mailAliasRevocation, projectChecklistTemplateCompanyScope.

## Added by the owner, 7 Nov 2026
- Remove from the project and sales order screen: Close all, Export, Quantity helper, Create PO. POs are raised only from MRP Proceed. An Export PDF stays as the PDF download.
- Draft DO can exist before goods are ready; Confirm confirms it. New phone screen for production workers: today's arrivals, by Project, Unit, DO, items, PO, date and time; Complete marks it done.
- Project receives every photo from its Production Orders, DO and GR through the PO link.
- Client PO: lines bought for the customer land in the project's client PO, with the supplier code, downloadable; Preview generates a link.
- 2D drawing photos flow into Built-in lines and onto the PO.
- Same fields for quotation and sales order, and for PO and GR. One screen for edit, confirm and view where possible.
- All PDFs share one header standard and match what is on screen. SO PDF by area or category. DO and GR download singly or together.
- Payment stays free: presets exist, any amount can be collected.
