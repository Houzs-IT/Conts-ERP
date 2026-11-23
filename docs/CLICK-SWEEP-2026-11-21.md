# Click sweep, 21 Nov 2026

End-user sweep of the ERP (engine screens at localhost:5179, signed in through Property OS SSO as
management@theconts.com) on the local system only, current main (5ef581b8). Console and network were watched on
every action (a fetch wrapper logged every engine call with status and duration). Two issues already owned by another
helper are not repeated here: the SO area swap 504 and the stale paid-to-date on the PDF.

Severity: **data** = data loss or wrong data, **blocked** = the user cannot finish the task, **cosmetic** = wrong text,
layout or a confusing message with no data effect.

## Fixed in this PR

| # | Screen | Problem | Fix |
|---|---|---|---|
| F1 | Sales order, Edit, Save | Any save of an SO holding a supplier-prefixed sofa line (here SOF-HKA-5547-2A(LHF), added from a package) failed: "This item is Compartment HKA-5547-2A(LHF), which this model doesn't offer ... This model offers ... 2A(LHF) ...". `PUT /renovation-so-info/:doc/lines/:id/spec` 400. Blocked every edit of TC-SO-2611-915. | `loadProductAndModel` (engine/backend/src/scm/lib/allowed-options-check.ts) did not select `base_model`, so the compartment check fell back to "after the first dash". The batched loader already selected it. Added it, plus a test that fails without it. Re-tested in the browser: the same save then succeeded. |
| F13 | Every message dialog with a list (e.g. "8 things need fixing before saving") | Console error: `<ul>` cannot be a descendant of `<p>` (NotifyDialog wraps the body in `<p>`). | Body wrapper is now a `<div>` with the same style. |

## Findings left open

| # | Screen | Steps | Expected | Actual | Evidence | Severity |
|---|---|---|---|---|---|---|
| F3 | Sales order (renovation contract), Edit, Order information | Change Built-up sq ft 950 to 951 on TC-SO-2611-915, Save, reload | 951 on the SO and its project | Save returns 200 and the page leaves edit mode; reload shows 950; DB SO and project both 950. The project activity even logs "Customer and property information saved from the sales order". Same for building, unit, property type, layout, bedrooms, bathrooms. | `PUT /renovation-so-info/TC-SO-2611-915` 200 with `builtUpSqft:"951"`. Cause: `writeSoPropertyColumns` (engine/backend/src/services/renovation/customerProperty.ts:236) has `WHERE coalesce(so_kind,'STANDARD') = 'STANDARD'`, so a RENOVATION SO is never written, then `writeSoToProject` copies the unchanged SO back to the project. The route comment says contracts share property both ways (owner, 1 Nov). All 10 local SOs are RENOVATION. | data |
| F9 | Sales order (confirmed, standard), Edit, rooms | Rename a room, move a room, delete an empty room, Save (with and without a price change) | Rooms saved | With a price change: "VO recorded", price saved, every room change silently dropped. With only room changes: "Saved - Nothing here changes what the customer pays, so no VO was needed", no request sent at all, nothing saved. | No `PUT .../rooms` in either case; DB `room_sections` unchanged. `submitAmendment` / `finishEditWithoutVo` in SalesOrderDetail.tsx never call `saveRenoRooms`; only the draft save path does (line 1167). | data |
| F6 | SO page Payments, project page Payments, project list | Open TC-SO-2611-915 (RM 8,350 collected; TC-SI-2611-009, instalment 1, is PAID, cleared by deposit) | Instalment 1 shown paid; schedule adds to the order total | SO page: all four instalments "Not paid" (1st RM 2,508 "Not paid TC-SI-2611-009"). Project page: "0 of 4 received", "1st payment Not confirmed", to-do "Instalment 1 is billed, not paid". Project list: "Pending 1st payment". Schedule 2,508 + 7,834 + 6,027 + 861 = 17,230 while the order total is 17,220 (the RM 10 credit note is not taken off). | Screens vs `scm.sales_invoices` (SI-009 status PAID). | data |
| F6b | SO page Payments, TC-SO-2611-911 | Open the SO | Instalments at their percentages of RM 960 | 1st 30% RM 288, 2nd "30%" RM 864, 3rd "35%" RM 672, 4th "5%" **RM -864.00** with a Bill button. A negative instalment can be billed. | Screen text. | data |
| F27 | Sales invoices list, KPI cards | Open the list on ALL | Outstanding = what open invoices still owe | Outstanding RM 2,928 includes the two CANCELLED invoices SI-002 and SI-004 (RM 864 each) and SI-001 which is PAID; the open invoices owe RM 912 (the SUBMITTED tab itself says RM 912). Billed RM 7,404 also counts cancelled ones (ALL tab says RM 4,812). The Outstanding column shows RM 864 on cancelled rows. | SalesInvoicesListV2.tsx:935-949 sums every visible row with no status check. | data |
| F28 | Sales invoices | Same list | Status agrees with money | SI-001 is PAID with paid 0 and Outstanding RM 288; SI-005 is CANCELLED but still holds a RM 864 receipt (money on a dead invoice). | `scm.sales_invoices` / `sales_invoice_payments`. | data |
| F25 | Delivery orders, TC-DO-2611-020 | Open DO-020 (SO TC-SO-2611-914) | A line already delivered cannot go on a second DO | Customer Wardrobe (SO qty 1) is DELIVERED on DO-016 and on DO-020 again (qty 1). DO-020 is LOADED in the DB but shown as CONFIRMED and counted under Confirmed, not Loaded. SO-914 shows DELIVERED with its pillow line DELIVERED though the pillow's only DO (020) is not delivered. Could be old seed data; the guard should be checked. | `scm.delivery_order_items` for SO-914. | data |
| F2 | Sales order Edit | Open Edit on TC-SO-2611-915, change only a header field, Save | Untouched lines untouched | "Saved - 2 lines updated": both sofa lines got `variants {legHeight: Default}` written and an audit row each, though nobody touched them. | Two `PUT .../lines/:id/spec` 200 for untouched lines. | data |
| F11 | New sales order | Fill the form, double-click Create Sales Order | One order, success | One order created (201) but the second click got 409 `idempotency_in_flight` and the screen shows "Save failed - This is already going through ... Please don't send it again" and stays on the filled new-order form. A user will think it failed. | `POST /mfg-sales-orders` 409 then 201. | data (risk of a second order on retry) |
| F12 | SO Payments, Add Payment | Double-click the row's Save | One receipt, success | One receipt saved (201) plus "Failed to save payment - This is already going through" and the row stays UNSAVED. Pressing Save again replayed the same key (no duplicate), but the screen says the opposite of what happened. | `POST .../payments` 409 then 201. | data (misleading) |
| F4 | Sales order Edit | Double-click Save | One save | Both clicks sent the full save (2x `PUT /renovation-so-info/:doc`, 2x each line spec). Harmless here because they are PUTs, but Save is not disabled while saving. | Network log. | cosmetic |
| F5 | Sales order Edit | Change a field, click Save once | Saves | First click did nothing (no request, no message) while a validate call was in flight; the second click saved. | `POST /validate` aborted, no PUT. | blocked (looks broken) |
| F10 | Sales order Edit (standard SO with rooms) | Open `?edit=1` on a cold page load | Rooms as saved | An extra empty "Living hall" room (from the layout) appeared that is not in `room_sections`; saving would add it back. Did not reproduce when Edit was opened from the page. | DB vs form. | data (minor) |
| F17 | New sales order, line | Pick "Works - Painting" or "HOOKKA Long Pillow" | Catalog price filled | Unit price stays 0.00. | Screen. | cosmetic |
| F18 | New sales order | Fill required fields | "Can't save - N to fix" counts down | Count stays stale (8 after four fields were filled) until a later re-render. | Screen. | cosmetic |
| F19 | Project page, Book appointment (Add work) | Type a note, click outside the dialog | Ask, or keep the dialog | Dialog closes and the typed text is lost. | Screen. | cosmetic |
| F20 | Purchase order, direct link by doc no | Open `/scm/purchase-orders/TC-PO-2611-104` | Open the PO, or "not found" | `GET /mfg-purchase-orders/TC-PO-2611-104` 500 and "Couldn't load purchase order - The system hit a problem". Links use the uuid, so only pasted/typed links hit it. | Network 500. | cosmetic |
| F21 | Purchase order TC-PO-2611-104 | Open | Status and banner agree | Status SUBMITTED with a Confirm PO button, banner says "already confirmed and live with the supplier". PO line allocates 3 to an SO line of qty 1. | Screen. | cosmetic |
| F23 | PO and GRN after Save | Save an edit | dd/mm/yyyy dates, URL leaves edit mode | View shows ISO dates (2026-11-18); URL keeps `?edit=1`. | Screen. | cosmetic |
| F24 | PO / GRN edit header | Edit a PO or GRN | Clear way out of edit | Next to Save sit "Cancel PO" (PO) and "Cancel" (GRN; also shown in view mode) - easy to mistake for "cancel my edit". | Screen. | cosmetic |
| F26 | Delivery orders list | Open the list | Built-in ships from On-site | DO-019 Customer Wardrobe (built-in, PO-102 to ONSITE) shows location CONTS-WH; DO-018 lists PO-099 (bought for SO-914) as its source PO. | Screen. | data (minor) |
| F8 | Sales orders list | Click a row (quick view) at 1366 px | KPI figures readable | Revenue / Outstanding / Paid figures are cut off ("RM 26,120.0(") while the quick view is open. | Screen. | cosmetic |
| F30 | Packages | Save a draft package | Can delete a draft | No delete on a draft package (only Duplicate / Activate / Save). | Screen. | cosmetic |
| F31 | SO page Payments after an invoice receipt | Record RM 100 on TC-SI-2611-008 (instalment 2 of TC-SO-2611-913), open the SO | Balance falls by RM 100 | Instalment 2 shows "RM 100.00 of RM 240.00 paid", but the SO's Balance stays RM 560.00 (counts only the RM 240 taken on the SO). Instalment 1 still says "Not paid" though TC-SI-2611-007 is PAID by the deposit. | Screen after a 201 on `POST /sales-invoices/:id/payments`. | data |
| F32 | Production order, Add time | Open Add time on TC-PRO-2611-907 before 5 pm, keep the defaults, Save | Saves, or defaults that can save | Default Stop is 5:00 PM today, so every save before 5 pm is refused: "Not saved - The stop time is in the future." Changing the Stop box by keyboard did not change what was sent in this test (still 09:00Z), so no time entry could be saved; needs a second look. Save also sent twice on a double-click. | `POST /production-orders/:id/hours` 422 x3. | blocked |
| F33 | Production orders list | Open the list | Completion figures agree | Completed orders show "Done in 1 day" with Plan Start 07/11 and Completion Date 20/11 (the plan finish, not when it was done); all show Stock Status NOT READY. Detail page header reads "PROGRESS · DAY 12 OF 1". | Screen. | cosmetic |
| F34 | Stock transfer, new | Type part of a SKU code | Suggestions, or "no such SKU" | No suggestion list; a partial code shows "No stock at source" (the lookup is for the literal text, `GET /inventory/buckets/CUS-WARD`). Only the full code works. A posted and a cancelled transfer both still show Edit. A project's customer-supplied wardrobe could be moved from ONSITE into CONTS-WH. | Network. | cosmetic |
| F35 | Delivery order, Edit | Open Edit on TC-DO-2611-020 | Flow shows the DO's real state | Document flow on the edit screen says "This DO - Draft" for a LOADED DO; two "Save changes" buttons side by side; `?edit=1` on the DO URL opens view mode (SO and PO open edit). | Screen. | cosmetic |
| F36 | Supplier, Lead times / SKU pricing | Double-click a lead-time Save | One save | Two identical `PUT /mrp-supplier-lead-times`. Harmless upsert. Price edits in SKU pricing save on blur with no confirmation shown. On-time rate "66.7% - 2 of 3 on time" while all three received POs were early or had no date. | Network. | cosmetic |
| F37 | Settings, Branding | Open Branding | Conts sample text | Placeholders show Houzs data (hello@houzscentury.com, houzscentury.com, a Houzs SSM number). | Screen. | cosmetic |
| F38 | Inventory | DB check | No negative stock | 7 negative balances (e.g. RN-ELECTRICAL -1 at one warehouse). | `scm.inventory_balances`. | data (seed?) |
| F7 | SO TC-SO-2611-915 | Open lines | Amount = qty x price | "HOOKKA Long Pillow (MRP test)" qty 1 x RM 80 shows RM 160 (stored `total_sen` 16000). Test seed row; no screen warns. | DB line 99. | data (seed) |

## Checked and working

- Two tabs editing the same SO: the second Save is refused with "Someone else updated this order while you were editing. Your changes are still on this screen." The first tab's value stayed.
- Double-click on Record VO, Save package, Add work, PO Save, GRN Save: one write each.
- VO on a confirmed SO (price change): VO recorded, applied, total and balance updated; print preview showed the new total and balance.
- New SO: rooms from layout, rename and reorder before create were saved correctly.
- Package create, edit qty, reload: kept.
- Project page tabs (Overview, Drawings, VO, SO, Client PO, DO, GR, Site & photos, Defects, Timeline) open with no API errors other than missing local files.
- PO edit (notes, supplier date), GRN edit (delivery note ref): saved and kept after reload.
- Purchase invoice from a GRN (Save as Draft): one PI; pressing Save again after "Stay here" did not create a second one.
- Stock transfer post and cancel: stock moved and came back (CUS-WARDROBE ONSITE 3 -> 2 -> 3).
- SKU edit (name), supplier SKU price (Price 1), supplier lead time, branding phone: saved, reloaded, reverted.
- PO edit, navigate away, come back: "Restore unsaved draft" offered (no leave warning, but nothing lost).
- Sales invoice Record payment: one receipt, invoice balance updated.

## Local environment notes (not bugs)

- The local DB had no `scm.my_localities` rows, so New SO was blocked on "Pick the delivery State". Two rows were seeded for the test and removed after.
- Local migrations 0349_user_roles, 0350, 0352, 0353 were not applied locally; applied before testing.
- Project page file links 404 locally (`object_missing`): the seed's files are not in the local bucket.

## Coverage

Two sessions on the shared local system (12:10-12:39 and 12:54-13:13), desktop width only (1366 and 1024 px).
Every area was opened from the menu, but not every button in every area was pressed. What was actually clicked:

| Area | Clicked | Not clicked |
|---|---|---|
| 1 Sales order | list, quick view, full page, Edit header + lines, rooms add/rename/move/delete, new SO, VO (Record VO), Collect payment, Print preview, two-tab edit, double-click on every save | area swap 504 (other helper), VO list page, Quotations, Request cancellation, Works started / Cancel contract, line photos, PDF file content |
| 2 Projects | hub, list, project page and every tab, Book appointment (Add work) | Calendar, Defects page, Handover checklists, Finances, Project maintenance, variants picking, key pass |
| 3 Purchase orders | list, quick view, full page, Edit + Save, direct link | Raise amendment, PO amendments page, Confirm / Send / Cancel PO, Add line, Transfer to GR |
| 4 Goods receipt | list, full page, Edit + Save | new GRN, Cancel GRN, proof-of-receipt photo, purchase return |
| 5 Delivery orders | list, full page, Edit + Save | Mark delivered, Cancel DO, new DO from SO, delivery returns |
| 6 Sales invoices and payments | list, full page, Record payment | new SI, Cancel SI, Mark paid, edit SI, receipts / official receipts pages |
| 7 Purchase invoices / payment vouchers | PI from GRN (draft), PV list | PI confirm and pay, new PV, PV approval |
| 8 Stock transfer | new, post, cancel | edit of a posted transfer |
| 9 Suppliers | detail, every tab, SKU pricing edit, Add SKU Mappings dialog (opened, cancelled), lead times | supplier edit, import/export bindings, combo pricing edit |
| 10 Products | SKU list, edit name | new SKU, photos, maintenance / variants / combo tabs |
| 11 Production orders | list, detail, Add time | Start, Complete, hold, raw-material return/request, photos |
| 12 Settings | Connection test, Email, Branding save, Documents, Activity log | document type edit, logo upload |

Phone widths were not tested in this sweep.

## Test data

Session 1: 9,607 rows before (737 tables in `scm`, `public`, `pos`), 9,609 after. Session 2: 9,697 before (the other
helper's work in between), 9,698 after. Every row created by the sweep was deleted and every edit reverted; the only
difference left is one new login session row per session (`public.sessions`), from signing in. Document number
counters advanced and were reset by deleting the counters the sweep created; SO number TC-SO-2611-916 was used and
deleted. Rows removed included the test SO 916 with its VO, payment and receipt, a package, a calendar entry, a
draft purchase invoice, a stock transfer with its four stock movements, an invoice receipt, and the audit rows they
wrote.

