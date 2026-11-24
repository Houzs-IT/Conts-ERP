# Click sweep 2, 21 Nov 2026

End-user sweep of the areas the first sweep (docs/CLICK-SWEEP-2026-11-21.md, "Not clicked" column) left out, on the
local system only, current main (4b062ef6), engine screens at localhost:5179 signed in through Property OS SSO as
management@theconts.com. Every area was opened from the left menu (phone width: see Coverage). A fetch wrapper
logged every engine call (method, URL, status, duration, body, error) and every save was checked against the local
database. First-sweep findings are not repeated.

Severity: **data** = data loss or wrong data, **blocked** = the user cannot finish the task, **cosmetic** = wrong text,
layout or a confusing message with no data effect.

## Fixed in this PR

None. Sweep only; the main session decides fixes.

## Findings left open

| # | Screen | Steps | Expected | Actual | Evidence | Severity |
|---|---|---|---|---|---|---|
| G1 | SO page, Renovation contract, Cancel contract | SO-917 (converted from a quotation, one RN-PAINTING line), Works started, then Cancel contract, Confirm | Contract cancelled | "Something went wrong; nothing was saved." Twice. SO stays In progress. | `POST /renovation/sales-orders/TC-SO-2611-917/status {"status":"CANCELLED"}` 500 renovation_failed. engine.log: PostgresError 22P02 malformed array literal "95d098a4-..." (the line id). renovation-so.ts:466-469 passes `goodsIds` (a JS array) through `db.q` -> `sql.unsafe` into `id = any($2::uuid[])`; unsafe sends it as text. The only renovation query that passes an array. Any contract with a non-service line cannot be cancelled, and an approved cancellation request ends in the same function (`cancelContractFromSoRoute`). Note for the owner: Cancel contract is a bare "Cancel contract?" confirm with no reason and no approval, while the header "Request cancellation" needs a reason and two approvers. | blocked |
| G2 | Production order, Request more, then Complete | TC-PRO-2611-914: Request more, Shellac Plywood DOR-KNK-003 x 2, double-click Send request; then Complete | One request of 2; 2 deducted | Two POST 201, two identical "Requested 2 NOS" rows (DB: two REQUESTED rows 19 ms apart). Complete then issued both: OUT 2 + OUT 2 at CONTS-WH, 4 deducted for a request of 2. | Network log; `scm.production_order_materials`, `scm.inventory_movements` source TC-PRO-2611-914. | data |
| G3 | GRN page, Cancel GRN; PO page, Cancel PO | New PO-106 (ACC-HKA-LONGPILLOW, CONTS-WH at -2), GRN of 4, then Cancel GRN | A GRN nobody used can be cancelled | 409 grn_consumed_downstream "Received goods were already consumed downstream (shipped / used in production)". Nothing consumed it: the bucket was -2 before the GRN, so on-hand 2 < 4 received (grn-reverse-guard.ts compares on-hand with the GRN qty). Cancel PO then refuses "PO has a Goods Receipt - delete or cancel it first". The PO and GRN cannot be undone from the screens, and the message names a cause that did not happen. Any item with negative stock (first-sweep F38: 7 buckets) is affected. | `PATCH /grns/:id/cancel` 409; `PATCH /mfg-purchase-orders/:id/cancel` 409. | blocked |
| G4 | New DO from SO, works line | Delivery orders, Transfer from Sales Order, pick SO-917 RN-PAINTING (picker shows "No PO yet"), Create | Works line waits for its PO / production, or is refused | DO created; OUT 1 RN-PAINTING at ONSITE with nothing received, ONSITE goes 0 -> -1. DO page says ship-from CONTS-WH. (Cancel DO put it back to 0.) | `scm.inventory_movements` TC-DO-2611-021; balance view. | data |
| G5 | Sales invoice, Mark paid | SO-917 Bill 1st payment -> SI-012 RM 450 -> Mark paid -> Save payments | Invoice PAID | Panel says "PAID IN FULL", header pill still SUBMITTED; DB status stays SENT, paid_sen 45000, paid_at null. Anything that reads status disagrees with the money. | `scm.sales_invoices` TC-SI-2611-012 after the 201 on `POST /sales-invoices/:id/payments`. | data |
| G6 | Sales invoice, Cancel SI | Cancel the fully paid SI-012 | Warn about the RM 450 receipt, or refuse | Plain confirm; cancelled. The invoice keeps paid_sen 45000 and the receipt; the SO header then shows "Customer credit balance RM 450.00" and instalment 1 is billable again, so the money is not lost, but the cancelled invoice page still reads "PAID IN FULL RM 450.00". Reproduces first-sweep F28 (SI-005) by clicks. | `PATCH /sales-invoices/:id/status` 200; DB. | data |
| G7 | Production order, Start | Start PRO-914 whose composition needs 0.5 sheet DOR-KNK-001 | 0.5 issued, or a visible round-up | 1 issued (qty_issued is a whole number); the Needed column silently changes from 0.5 to "1 NOS". | `production_order_materials` qty_needed 0.5, qty_issued 1; OUT 1. | data (minor) |
| G8 | Production order, Return stock | Return the 1 issued sheet, keep the dialog's warehouse | Back into CONTS-WH where it came from | Warehouse box defaults to BLK (first in the list); the return moved the sheet from CONTS-WH to BLK. | OUT 1 CONTS-WH, IN 1 BLK. | data (minor) |
| G9 | Delivery returns list, KPI | Open the list | Refund value = open returns | RM 2,596 includes the CANCELLED DR-004 (RM 80) (2,500 + 8 + 8 + 80). Same pattern as first-sweep F27 (SI list). | Screen vs `scm.delivery_returns`. | data (display) |
| G10 | Print PDF (quotation, SO; every page using PrintPreviewModal) | Click Print PDF on the local dev server | Print preview opens | Opens and closes in the same instant (a MutationObserver saw open -> closed), nothing on screen, no error. `ClosesOnLeave` (PrintPreviewModal.tsx) skips only its first effect run with a ref; React StrictMode in the vite dev server runs the effect twice on mount and the second run calls onLeave. Local dev only; the production build was not tested here. | Dialog class `pointer-events-none opacity-0` right after the click; /@vite/client + StrictMode in main.tsx. | blocked (local dev) |
| G11 | Phone width: DO / PO / GRN / PI / purchase return / delivery return / SI pages | Tap the "..." in the page header | Menu with the other actions | Does nothing: the button has no onClick (DeliveryOrderDetailV2.tsx:1051, PurchaseOrderDetailV2.tsx:1160, GoodsReceivedDetailV2.tsx:647, PurchaseInvoiceDetailV2.tsx:708, PurchaseReturnDetailV2.tsx:493, DeliveryReturnDetailV2.tsx:821, SalesInvoiceDetailV2.tsx:1198). On a phone there is no Cancel DO / Undo load, no Cancel PO / Raise amendment / Send to supplier. Tap target 18 x 18 px. | No menu in the DOM after the tap; source. | blocked |
| G12 | SO Payments, Bill | Double-click "Issue invoice" | One request | Two POSTs (button not disabled while pending): 201 + 409 already_billed. One SI, but the dialog shows the green "invoice created" box and a red "Instalment 1 is already billed." together. | Network log. | cosmetic |
| G13 | VO quick view | VO list, click VO-915-03 | Status shown once, consistently | Badge APPROVED and a red "Rejected." box. AmendmentQuickView.tsx:273 shows the box for any non-null `resolution`, and every renovation VO has `resolution = RENOVATION_VO`. Full page shows APPROVED + PROCESSING + "Sent" and "No activity recorded yet". | DB `so_amendments.status = SENT`, `rejected_* null`. | cosmetic |
| G14 | VO list tabs | Withdraw a cancellation request | Counted as withdrawn | Counted under the REJECTED tab (1). | Screen. | cosmetic |
| G15 | SO header, Request cancellation | Raise a request, click Request cancellation again | Button hidden while one is open | Button still shown; the second request is refused with a clear 409 dialog ("already open"). | 409 cancel_request_open. | cosmetic |
| G16 | Production order, Complete | Click Complete with "Raw materials 0 of 3 ready" | Confirm first | One click, no confirm: three POSTs (grn, do, deliver) raise and post a GRN and a delivered DO. The completed page still offers "Start time". | Network log. | cosmetic |
| G17 | Cancelled documents | Cancel a DR, a PI, a voucher | Header shows the cancelled state | Cancelled DR still headed "REFUND PENDING RM 1,200.00"; cancelled PI "Owed RM 160.00" in red with an Edit button; the PI cancel dialog says "Any posted revenue will be reversed" (it is a purchase invoice); cancelled voucher still lists "Applied RM 100.00". | Screens. | cosmetic |
| G18 | New delivery return | Create a DR via Transfer from Delivery Order | Land on the new DR | Lands on the source DO page. | URL after create. | cosmetic |
| G19 | New PO, item code | Type "LONGPILLOW" | Suggestions | Native datalist matches from the start only; nothing until the full code ACC-HKA-LONGPILLOW is typed. | Screen. | cosmetic |
| G20 | Phone, PO list / production order list / quick view | Open the lists | Totals agree; production cards show the work | PO list header "21 POs - RM 1,440.00 committed" vs ALL chip RM 1,240 (header counts cancelled PO-107). Production order cards are PO cards ("SUPPLIER INHOUSE", "RM 0.00 committed"). Quick-view header wraps the doc no over two lines. | Screens. | cosmetic |

## Checked and working

- Quotation: new (one POST), edit address / remark / price (PUT 200, reload and DB kept), Mark sent, Accepted (confirm), Convert (double-clicked the confirm: one POST 201; SO with the same total, line and address; quotation locked).
- SO Request cancellation: empty reason refused in the dialog; double-click submit sent one request; banner "level 1 (1 of 2)"; Withdraw cleared it.
- Works started: one POST, status In progress.
- Delivery return from a delivered DO: double-click Create made one DR (idempotency 409 + replay); stock 0 -> 1; Cancel return 1 -> 0.
- New PO (double-click Create: one PO), Send to supplier with no supplier email (clear dialog, nothing sent), Copy as new, Cancel PO with reason (one PATCH, Reopen offered).
- PO amendment: double-click submit guarded (201 + 409 already open); Approve applied qty 3 -> 5, RM 120 -> 200, revision 2.
- GRN from PO (partial, 4 of 5): double-click gave one GRN and a clear "already created" dialog; PO -> PARTIALLY_RECEIVED; stock +4.
- PI from GRN: created and posted in one step (there is no separate Confirm); ledger-binding warning shown (known).
- AP payment voucher: partial RM 100 draft, Prepare; Check and Post now refused cleanly (voucher stays DRAFT, nothing half-done); Cancel released the PI back to RM 160 outstanding.
- New DO from SO (double-click Create: one DO), Mark delivered (date dialog, one PATCH), Cancel DO on a delivered DO (reason, one PATCH, stock back).
- Production order: create from SO, Put on hold / Take off hold, Start anyway (one POST), Return stock (double-click: 409 + 200, one return).
- Phone width: SO list and page, DO page (Mark delivered present), PO page, production order page all fit 375 px with no horizontal scroll.

## Local environment notes (not bugs)

- No payment voucher can pass Check locally: bank account 310-0010 has no series letter on the Voucher numbering card (409 bank_letter_missing). Approvals are not off: the Prepare / Check / Approve chain is shown.
- `resize_window` had no effect (the Chrome window is maximized; innerWidth stayed 2048). Phone pages were tested in a 375 x 812 frame of 5179; the app hides its own menu when framed, so entry there was list -> card -> Open full page. The 8799 phone shell itself was opened at 375 px; its Supply chain items open 5179 in the top window. No window size to reset.
- The local clock passed midnight (UTC+8) during the session, so later documents are dated 22/11/2026.

## Coverage

One session, 15:27-16:20 UTC on 21 Nov, desktop 1522 px wide plus the phone frame.

| Area | Clicked | Not clicked |
|---|---|---|
| 1 Quotations | list, quick view, new, edit, Print PDF (G10), Mark sent, Accepted, Convert to SO | Copy as new, Save as package template, New revision, Rejected, Undo accept |
| 2 VO | VO list, VO quick view, VO full page | approve / reject a pending VO (none pending) |
| 3 Delivery returns | list, Transfer from DO, new DR, Cancel return, stock checked | Mark inspected, refund |
| 4 Confirm / cancel | SO Request cancellation + withdraw, Works started, Cancel contract (G1), PO Send / Cancel / Raise amendment / Approve, GRN new + Cancel (G3), DO new / Mark delivered / Cancel, SI Bill / Mark paid / Cancel | PO Confirm (new POs are born SUBMITTED; the button is disabled), approving a cancellation request (needs a second approver), Works completed / Close contract, Undo load |
| 5 PI / PV | PI from GRN, PI cancel, new AP payment, Prepare, Check, Post now, Cancel voucher | PV approve (blocked locally by the bank letter), PI hold |
| 6 Production orders | create from SO, hold / unhold, Start, Return stock, Request more, Complete | Reopen, Add time (first-sweep F32), photos, worker assign |
| 7 Phone width | SO list + page, DO page (two), PO page, production order list + page, 8799 phone menu | actions beyond opening them (More actions is dead, G11) |

## Test data

Row count before: 9,710 rows in 738 tables (`before-sweep2.json`). After cleanup: 9,713; the only difference is
public.sessions +3 (login sessions). Everything the sweep created was deleted in one transaction: quotation
QT-2611-007 with its revision; SO TC-SO-2611-917 with contract, sections, lines, 8 instalments, bill, cancel request,
status changes and audit, plus its debtor, account and customer credit; SI TC-SI-2611-012 with its receipt and
official receipt; POs TC-PO-2611-106 / 107 / 108 with amendment and revision; GRNs 018 / 019; PI TC-PI-2611-001;
voucher TC-Draft-2611-002 with its allocation; DR TC-DR-2611-005; DOs 021 / 022; production order TC-PRO-2611-914
with materials and worker; journal entry JE-2611-0010; 11 stock movements, 5 lots and 3 lot consumptions (one older
lot's qty_remaining put back from 0 to 1); 34 entity audit rows; 11 idempotency keys; and the delete-trigger rows
(mfg_so_item_deletions, venture_portal_outbox). Stock is back to the starting balances (DOR-KNK-001 CONTS-WH -923,
BLK 0; DOR-KNK-003 -299; ACC-HKA-LONGPILLOW -2; AKEMI APEX MATT (S) 0; RN-PAINTING ONSITE 0). Document counters were
set back to their saved values (QT 7, SO 917, PO 106, GRN 18, DO 21, DR 5, SI 12, PRO 914, JE 10, Draft 2) and the new
TC-PI-2611 counter removed. The MRP snapshot that the stock moves had invalidated was rebuilt by opening
MRP - stock status from the menu.

## Working notes (evidence, in order)

- 15:27 Quotations list opened from menu. New quotation QT-2611-007 (SWEEP2 Test Customer, Works - Painting RM 1,234) created, one POST, DB ok.
- Edit: address line 2, remark, price 1,500 -> PUT 200, reload + DB kept (site_address "1 Sweep Street\nnit 5", the "U" was lost by the test typing, not the app).
- Print PDF on quotation AND on SO: dialog opens and closes in the same instant (MutationObserver saw open -> closed). Cause: ClosesOnLeave (PrintPreviewModal.tsx) skips only the first effect run via a ref; React StrictMode in the vite dev server runs the effect twice on mount, the second run calls onLeave. Dev-only (local 5179 runs /@vite/client + StrictMode); production build untested.
- Mark sent -> Accepted (confirm) -> Convert (double-clicked the confirm): one POST convert 201, SO TC-SO-2611-917 RM 1,500, address kept, quotation locked.
- Request cancellation on SO-917: empty reason refused in the dialog; double-click submit -> one POST 201; banner "waiting level 1 (1 of 2)"; Request cancellation button still shown, second request -> 409 "already open" shown in a dialog (guarded). Withdraw -> 200, banner gone.
- VO list: 5 rows; my withdrawn cancellation is counted in the REJECTED tab (1). VO quick view of VO-915-03 says APPROVED and shows a red "Rejected." box: AmendmentQuickView.tsx:273 shows the box for any non-null resolution, and every renovation VO has resolution RENOVATION_VO. VO full page: badges APPROVED + PROCESSING + "Sent", approval history "No activity recorded yet".
- Works started / Cancel contract: exist only in RenovationSalesOrder.tsx, which on desktop is routed to ContractMoved (redirect); only the phone route mounts it. Desktop SO page has no such buttons. (check at phone width)
- Delivery returns list KPI "Refund value" RM 2,596 counts the CANCELLED DR-004 (RM 80) (2,500 + 8 + 8 + 80). Same class as first sweep F27.
- Transfer from DO -> picked DO-018 AKEMI APEX MATT (S) -> New DR form -> double-click Create: POSTs 409 (in flight), 201, 201 (replay); ONE DR (TC-DR-2611-005, RECEIVED). Stock CONTS-WH AKEMI (S) 0 -> 1 (one IN movement). After create the app opened the DO page, not the new DR.
- DR Cancel return (double-click confirm): one PATCH 200, stock 1 -> 0 (ADJUSTMENT -1). Cancelled page still headed "REFUND PENDING RM 1,200.00".
- New PO (HOOKKA, ACC-HKA-LONGPILLOW x3 @ RM 40) double-clicked Create: 409 + 201 + 201 replay; ONE PO TC-PO-2611-106, created SUBMITTED. Confirm PO button disabled (PO is born SUBMITTED; nothing to confirm), banner "already confirmed and live with the supplier". Item picker is a native datalist: partial "LONGPILLOW" gives no match (prefix only), full code works.
- Send to supplier: "No supplier email" dialog, nothing sent (HOOKKA has no email). Activity still lists "Submitted to supplier" from create.
- Raise amendment qty 3 -> 5, double-click submit: 201 + 409 amendment_already_open (guard), one amendment A1, "Amendment raised". Approve (double-click confirm): one PATCH 200; PO shows 106_R1, qty 5, RM 200; DB total 20000, revision 2.
- GRN from PO, received 4 of 5, double-click Create: 409 in-flight + 201 + replay 201 with a clear "already created" dialog; ONE GRN TC-GRN-2611-018 POSTED; PO -> PARTIALLY_RECEIVED; stock CONTS-WH LONGPILLOW -2 -> 2 (+4).
- PI from GRN (Create, not draft): TC-PI-2611-001 POSTED (shown SUBMITTED); warning "not in the ledger yet, FURNITURE not bound" (known ledger-binding-pending). No separate Confirm step: Create = confirmed.
- New AP payment from PI, apply RM 100 (partial): draft voucher TC-Draft-2611-002; allocation reserves 100 (form then shows outstanding RM 60). Prepare -> 200. Check -> 409 bank_letter_missing "310-0010 has no series letter yet"; Post now -> same 409. Voucher stayed DRAFT, nothing half-done. Approvals are not off: Prepare/Check/Approve chain shown, but no voucher can pass Check locally (bank letter not set up).
- Cancel voucher -> 200 CANCELLED; PI outstanding back to RM 160 (pv_allocations row stays, ignored). Cancelled voucher page still lists "Applied RM 100.00".
- Cancel PI -> CANCELLED; dialog says "Any posted revenue will be reversed" (it is a purchase invoice); cancelled PI still shows "Owed RM 160.00" in red and an Edit button.
- Cancel GRN-018 -> 409 grn_consumed_downstream "already consumed downstream (shipped / used in production)". Nothing consumed it: the bucket was at -2 before the GRN, so on-hand 2 < 4 received (grn-reverse-guard.ts compares on-hand with qty). A wrong GRN on any item with negative stock cannot be undone, and the message names a cause that did not happen.
- Cancel PO-106 (has the stuck GRN): 409 "PO has a Goods Receipt - delete or cancel it first". With GRN-018 not cancellable either, PO-106 cannot be closed from the screens.
- Copy as new -> PO-107 created (one POST) -> Cancel PO (reason, double-click confirm): one PATCH 200, CANCELLED, Reopen offered.
- New DO from SO-917 (works line RN-PAINTING, "No PO yet" in the picker), double-click Create: 409 + 201 + replay 201, onsite-twin called twice; ONE DO TC-DO-2611-021 (LOADED, shown Confirmed). Stock: OUT 1 RN-PAINTING at ONSITE -> ONSITE goes 0 -> -1 (no PO, no receipt). DO page says ship-from CONTS-WH. SO-917 header immediately showed "DELIVERED" while its only DO was LOADED (same as first sweep F25 display).
- Mark delivered (date dialog, double-click confirm): one PATCH 200, DELIVERED. Cancel DO on the delivered DO (reason, double-click): one PATCH 200, CANCELLED, ADJUSTMENT +1 -> ONSITE back to 0.
- Correction: the desktop SO page DOES show the Renovation contract block (Save as package / Works started / Cancel contract) under Payments.
- SO-917 Payments, Bill 1st payment, double-click "Issue invoice": TWO POSTs (button not disabled): 201 + 409 already_billed. One SI (TC-SI-2611-012, RM 450). The dialog then shows the green "Sales invoice TC-SI-2611-012 ... journal not posted yet" box AND a red "Instalment 1 is already billed." box together.
- SI-012 Mark paid -> payment row RM 450 cash -> Save payments (double-click): one POST 201; screen "PAID IN FULL", but header pill still SUBMITTED and DB status stays SENT (paid_sen 45000, paid_at null).
- Cancel SI on the fully paid SI-012: confirm dialog says nothing about the RM 450 receipt; PATCH 200 CANCELLED; DB keeps paid_sen 45000 and the receipt row: money left on a dead invoice (reproduces first sweep F28 SI-005 by clicks). Cancelled SI page still headed "PAID IN FULL RM 450.00".
- After cancelling SI-012 the SO header shows "Customer credit balance RM 450.00" and instalment 1 is billable again: the receipt surfaces as customer credit (so the previous note is less severe: money is not lost, but the invoice row still says paid 450).
- Works started on SO-917 (confirm) -> POST status 200, WORKS IN PROGRESS, buttons become Works completed / Cancel contract.
- Cancel contract (bare "Cancel contract?" confirm, no reason, no approval, unlike header "Request cancellation" which needs 2 approvers) -> POST status 500 renovation_failed "Something went wrong; nothing was saved". engine.log: PostgresError 22P02 malformed array literal "95d098a4-..." (the SO line id). renovation-so.ts:466-469 passes goodsIds (a JS array) to db.q -> sql.unsafe, which sends it as text, into `id = any($2::uuid[])`. Only renovation line that does this. Any contract with a goods (non-service) line cannot be cancelled, and the approved cancellation request path (cancelContractFromSoRoute) runs the same function. Reproduced twice; SO stayed RENO_IN_PROGRESS.
- Production orders list -> Transfer from Sales Order -> picked SO-917 RN-PAINTING -> continue: TC-PRO-2611-914 created at once with in-house PO TC-PO-2611-108, raw material Plywood DOR-KNK-001 needed 0.5 (from SKU composition).
- Put on hold (double-click confirm): one PATCH 200, ON HOLD, Start hidden. Take off hold: one PATCH 200, back to PENDING.
- Start -> "Raw materials not ready" -> Start anyway (double-click): one POST 200, IN PROGRESS. Stock OUT 1 DOR-KNK-001 from CONTS-WH, although only 0.5 is needed: qty_issued is a whole number, so the 0.5 is issued as 1 and the screen's Needed changes from 0.5 to "1 NOS".
- Return stock: the warehouse box defaults to BLK (first in the list), not CONTS-WH where it was issued; returned 1 (double-click): 409 "changed while you were returning it" (moved 0) + 200; one IN 1 at BLK. So one click moves the plywood from CONTS-WH to BLK.
- Request more (Shellac Plywood DOR-KNK-003 x2, double-click Send request): TWO POST 201, two identical "Requested 2 NOS" material rows (DB: two REQUESTED rows 19 ms apart). No double-submit guard.
- Complete: ONE click, no confirm dialog, runs three POSTs (complete step grn / do / deliver, all 200): GRN TC-GRN-2611-019 POSTED, DO TC-DO-2611-022 DELIVERED, PRO RECEIVED/Completed, although the panel said "Raw materials 0 of 3 ready". Complete issued BOTH duplicate requested rows: OUT 2 + OUT 2 DOR-KNK-003 at CONTS-WH = 4 deducted for a request of 2. Completed page still offers "Start time".
- Phone width: resize_window had no effect (the Chrome window is maximized; innerWidth stayed 2048). The 8799 phone shell (tested in a 375 px frame) opens Supply chain items in the top window, so phone users run 5179 top-level. Tested 5179 pages in a 375 x 812 iframe (the app hides its own nav when framed, so entry was list -> card -> Open full page, not the menu).
  - SO list (cards) and SO page: fit, no horizontal scroll (scrollWidth 375). Bill, Collect payment, Works completed, Cancel contract, Edit all present. Quick-view header wraps the doc no over two lines.
  - DO page: fits. Mark delivered present on a LOADED DO. The header "..." (More actions) button does nothing: DeliveryOrderDetailV2.tsx:1051 has no onClick. Same dead button in PurchaseOrderDetailV2.tsx:1160, GoodsReceivedDetailV2.tsx:647, PurchaseInvoiceDetailV2.tsx:708, PurchaseReturnDetailV2.tsx:493, DeliveryReturnDetailV2.tsx:821, SalesInvoiceDetailV2.tsx:1198. Result: on a phone there is no Cancel DO / Undo load (DO), no Cancel PO / Raise amendment / Send to supplier (PO).
  - PO list header "21 POs - RM 1,440.00 committed" while the ALL chip says RM 1,240 (header counts cancelled PO-107 RM 200).
  - Production order list cards are PO cards ("SUPPLIER INHOUSE", "RM 0.00 committed"); page fits, Reopen / Return stock / Add time present.
