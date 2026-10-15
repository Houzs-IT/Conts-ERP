# Renovation document flow: what each document carries (batch 4, 14 Oct 2026)

Owner request: in Supply Chain, a renovation job runs Quotation -> Sales Order (SO) -> Delivery Order (DO) ->
Purchase Order (PO) -> Goods Receipt (GR) -> Sales Invoice (SI). Every document should arrive with the right
customer, property and room information, the same as what the SO now holds (PR #247, migration 0112).

This file is the checklist: one row per piece of information, one column per document.

- **Carried** = the document already gets it from the one before it, today, on `main`.
- **Missing** = it should be there and is not. These are what this PR (migration 0116) fixes; the cell says how.
- **N/A** = does not belong on that document (a supplier's PO does not need the customer's phone).

Only renovation mode (`app_settings.projects_mode = 'renovation'`) changes. A Houzs furniture order flows exactly as before.

## How the copying works after this PR

- **Quotation -> SO**: copied when the accepted quotation is converted (`engine/backend/src/scm/lib/renovation-so.ts`,
  `convertQuotationToSo`, now calling `stampContractFromQuotation` in `engine/backend/src/scm/lib/renovation-doc-flow.ts`).
- **SO -> DO, SO/DO -> SI, SO -> PO, PO -> GR**: copied by the database at the moment the document is saved
  (triggers in `migrations-pg/0116_reno_doc_flow.sql`). Every way of making the document gets it the same: the Houzs
  "from SO" screens, a hand-made DO that names its SO, the renovation "Raise POs" button, progress billing, a GR from a PO.
  The database only fills what the screen left blank; it never overwrites what someone typed.
- **Showing it**: one read (`GET /api/scm/renovation-doc-flow/:kind/:id`, `engine/backend/src/scm/routes/renovation-doc-flow.ts`)
  feeds a "Project" block and a Room column on the DO, SI, PO and GR pages, and the same lines on their prints.

## The table

| Information | Quotation | SO | DO | PO | GR | SI |
|---|---|---|---|---|---|---|
| Customer name | Carried (typed on the quotation, or from its project) | Carried (conversion copies it) | Carried (from the SO) | N/A (supplier document) | N/A | Carried (from the SO or DO) |
| Phone | Carried | Carried | Carried | N/A | N/A | Carried from a DO. **Missing on a progress-billing invoice** -> now filled from the SO |
| Email | Carried | Carried | Carried | N/A | N/A | Same as phone |
| Site / delivery address | **Missing** -> new "Site address" on the quotation | Normal SO carried. **Converted contract was wrong** (put building in address line 1, unit in line 2) -> now the quotation's site address | Carried (from the SO) | N/A | N/A | Carried from a DO. **Missing on progress billing** -> now from the SO |
| Project | Carried (the quotation's project) | Carried | **Missing** -> now the SO's project | **Missing** -> now the project of the SO its lines came from | **Missing** (only a site receipt had it) -> now the PO's project | **Missing** -> now the SO's (or DO's) project |
| Building | Carried | Normal SO carried. **Converted contract missing** -> now copied | **Missing** -> now from the SO | N/A (shown through the project) | N/A (shown through the project) | **Missing** -> now from the SO |
| Unit | Carried | Same as building | **Missing** -> now from the SO | N/A | N/A | **Missing** -> now from the SO |
| Property type | **Missing** -> new on the quotation | Normal SO carried. **Converted contract missing** -> now copied | N/A (on the project) | N/A | N/A | N/A |
| Layout (label, bedrooms, bathrooms) | **Missing** -> new on the quotation | Same as property type | N/A | N/A | N/A | N/A |
| Built-up sq ft | **Missing** -> new on the quotation | Same as property type | N/A | N/A | N/A | N/A |
| Room, per line | Carried (sections and each line's room) | Normal SO carried. **Converted contract**: only in its own section tables -> now also on each SO line and the SO's room list | **Missing** -> now each line's SO room | **Missing** -> now each line's SO room | **Missing** -> now each line's PO room | **Missing** -> now each line's SO (or DO) room |
| Category / sub-category, per line | Carried (from the product) | Carried (from the product) | N/A | **Missing** -> now copied from the product (e.g. WORKS / ELECTRICAL) | **Missing** -> now from the PO line | N/A |
| Item, description, quantity, price | Carried | Carried | Carried | Carried (cost price) | Carried (PO price, quantity received) | Carried |
| Dates | Carried (date, valid until) | Carried (SO date picked at conversion) | Carried (DO date and delivery date default to the SO's) | Carried (PO date, expected date as entered) | Carried (received date) | Carried (invoice and due date) |
| Points back to the document before | N/A | Carried (contract keeps the quotation number) | Carried (SO number) | Carried per line (each PO line knows its SO line); the page now also lists the SO numbers | Carried (PO number) | Carried (SO number and DO) |

## Where it lives in code

| Step | Where |
|---|---|
| Quotation stores the property block | `scm.reno_quotation_revisions` new columns (0116); read and written in `engine/backend/src/scm/lib/renovation-doc-flow.ts` (`readRevisionProperty`, `writeRevisionProperty`), called from `renovation-quotation.ts` |
| New quotation fills blanks from its project | `readProjectParty` + `fillBlanksFromProject` in `renovation-doc-flow.ts`, called from `createQuotation` |
| Quotation -> contract SO | `stampContractFromQuotation` in `renovation-doc-flow.ts` (address, building, unit, property, room list, each line's room) |
| SO -> DO header and lines | trigger `scm.reno_flow_delivery_order` / `scm.reno_flow_delivery_order_item` (0116) |
| SO or DO -> SI header and lines | trigger `scm.reno_flow_sales_invoice` / `scm.reno_flow_sales_invoice_item` (0116) |
| SO -> PO lines, then PO header project | trigger `scm.reno_flow_po_item` (before) and `scm.reno_flow_po_item_project` (after) (0116) |
| PO -> GR header and lines | trigger `scm.reno_flow_grn` / `scm.reno_flow_grn_item` / `scm.reno_flow_grn_item_project` (0116) |
| Read for the pages and prints | `engine/backend/src/scm/routes/renovation-doc-flow.ts` |
| Pages | `engine/frontend/src/pages/scm-v2/RenovationDocInfo.tsx` (block + Room column) on the DO, SI, PO and GR pages; quotation page `pages/renovation/QuotationEditor.tsx` |
| Prints | `engine/frontend/src/vendor/scm/lib/renovation-doc-print.ts` used by the DO, SI, PO and GR PDFs; quotation PDF `lib/renovation/renovation-doc-pdf.ts` |
| One category per renovation PO | "Raise POs" splits by supplier AND category (`scm/lib/renovation-po-split.ts`); trigger `scm.reno_flow_po_item` refuses a line of another category on a project's PO; the PO keeps `category_group` (+ `sub_category` while all lines share one) (0116) |
| The project's documents | `GET /api/renovation/:id/documents` (`routes/renovationDocuments.ts`, `services/renovation/documents.ts`) |
| Procurement details = documents hub | `engine/frontend/src/pages/projects/renovation/ProcurementPanel.tsx` + `ProcurementPos.tsx` |

## Purchase orders are split by category (owner, 14 Oct 2026)

One PO never mixes categories, so one SO usually becomes 10-20 POs, each under one category (Works, Built-in,
Furniture, Lighting, Appliances, Soft furnishing, Service) and often one sub-category. A renovation PO (one that has
a project) records its category; adding a line of another category to it is refused with a sentence that names both
categories. Houzs furniture POs have no project and are never checked.

## The project page (owner, 14 Oct 2026)

- **Procurement details is the documents hub.** On top: the quotation and the sales order(s); under each SO its
  delivery orders with their proof of delivery (signed / delivered date, opening the DO) and its invoices. Then each
  category and sub-category row: the planned PO and delivery date (the plan, still editable), the actual dates from
  its POs, "2 PO · 1 received", and LATE when the planned delivery has passed and the goods are not all received.
  Opened, a row lists its POs (number, supplier, PO date, due date, received / partly / not), and under each PO its
  goods receipts with the site photos taken at receipt ("3 photos", which opens them and the printable note).
  A category opens on the sub-categories that have POs or their own dates; "Show all N sub-categories" opens the rest.
  Every number opens its document.
- The separate Site tasks card and "Proof of delivery by room" card are no longer on the page (data, APIs and the
  calendar are unchanged). The older Documents card shows only until migration 0116 is applied.
- The status strip (a wide row of mostly dashes) is gone: its facts that say something (contract, received, supply
  state, who holds the key, handover) sit in one small row inside the step card, and the step reads plainly, e.g.
  "Closed (set by hand)" with a small "use data" link.
- Left = work (Design, Procurement details); right = reference (Customer info, Project team, Unit key, Contract).

## Deliberately not done here

- **POs are not created from the project's procurement dates** (category / sub-category PO date and delivery date,
  migration 0111). Next step: a "Raise POs due" action that, for each category whose PO date has come, raises the PO
  for that category's SO lines with the procurement delivery date as the PO's expected date.
- Property type, layout and sq ft are not copied onto the DO, PO, GR or SI: those documents point at the project,
  which holds them. Printing them on a supplier's PO would be noise.
- Converting a quotation does not write back to the project (the project stays the master). A converted contract is
  printed as signed, like before.
- **Design files on PO, GR and DO (later, not now):** the onsite, 3D and 2D design files of the project will be
  carried onto its POs, GRs and DOs, so a supplier and the site team see the drawing for what they deliver.
- A mixed-category line added on the Houzs PO screen is refused by the database; that screen shows the refusal as
  a failed save with the sentence (HTTP 500 "insert_failed" with the reason), not as a friendly form error.
- Documents saved before migration 0116 is applied keep what they had; the migration fills the room, project,
  building and unit on existing renovation-mode documents once, when it is applied.

## Procurement details, second version (owner, 15 Oct 2026)

The owner only wants to know what has been received and delivered, not every item, PO or SO. Procurement details
now works per category and sub-category:

- **Ordered -> Received -> Delivered**: counts of the project's item lines in that row (lines of its sales orders, and
  project PO lines no SO line stands behind). Ordered = on a live PO; Received = a goods receipt took the quantity in;
  Delivered = a delivery order handed it over, or a site receipt took it in at the unit (that is both at once).
- **Ready**: a sub-category when everything ordered in it is received and delivered; a category when every one of its
  sub-categories with items is Ready. **LATE**: the planned delivery date has passed and the row is not Ready.
- Under each row, the goods receipts (date, at site, photos) and delivery orders (date, proof of delivery) behind it,
  each opening its document. No item, PO or SO rows.
- A sub-category shows only when it has items or its own dates; a following one shows the category's dates greyed.
  "Plan another sub-category" brings up any other to give it dates. A category opens by itself only when it has items.
- Read from `GET /api/renovation/:id/procurement-status` (`engine/backend/src/services/renovation/procurementStatus.ts`),
  counted in `engine/frontend/src/pages/projects/renovation/procurementStatusModel.ts`. No migration.
