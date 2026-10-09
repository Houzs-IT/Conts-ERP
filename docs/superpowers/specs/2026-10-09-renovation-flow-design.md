# Renovation flow: Project + Supply Chain redesign

Date: 2026-10-09. Status: approved by the owner in chat (brainstorm 2026-10-08/09).
Scope: turn the engine's supply chain and Projects module into the business flow of an
ID + full-home-customisation company (Dream Crafter / The Conts), from design to handover.

## 1. Decisions (owner, in chat)

| Topic | Decision |
|---|---|
| Customers | Both: Conts-managed owner units and outside customers |
| Leads | Live in a CRM list, not in Projects. A project is opened when design starts |
| Project module | Rework the engine's Houzs exhibition Projects module in place. The engine now diverges from Houzs on purpose; record this in `CLAUDE.md` |
| Execution | Everything is subcontracted: every trade and every supplier gets a PO. Built-in carpentry is factory-made and lands in the Furniture stage |
| Customer billing | Payment-term templates (e.g. 15/50/30/5, 30/30/35/5) with a description per instalment, editable per document, each instalment tied to a stage |
| VO | Its own document (VO number, add and omit lines, customer signature). Added to the contract sum; the next unbilled instalment catches up the difference; a net negative becomes a credit note |
| Subcontractor payment | Per-PO payment schedule; default template Mobilise / Completion / Retention; retention released after handover and defects closed |
| Quotation | A copy of the SO structure with revisions (R1, R2...) and reusable package templates; an accepted revision converts to the SO in one step |
| Quantities | Integer `qty` plus an optional decimal `measure` with its unit; amount = measure x rate when a measure is set, else qty x rate |
| Old catalog screens | Hide (do not delete) Modular, Fabric Converter and the old Categories tab |
| Signing order | Both orders happen (sign first, or finalise drawings first). Signing is an event, not a fixed stage |
| Skipping | Stages and checklist items can be skipped: automatically from SO contents, or by hand with a reason |

## 2. Delivery phases

| Phase | Content | Depends on |
|---|---|---|
| 1. Catalog | New category tree, UOM list, photos per SKU, supplier/subcontractor binding as default PO party, hide old tabs | none |
| 2. Sales documents | Quotation (revisions, templates), SO structure (brand, sections, parent/child lines, measure, discounts, FOC), VO, SO -> PO split, payment-term templates, 5 print formats | 1 (category codes only) |
| 3. Project | Exhibition project reworked to renovation project; stages, checklists, skip rules, stage gates, billing prompts, POD/evidence | 2 (SO link) |
| 4. Close-out | Project cost sheet (budget / ordered / paid / margin), handover snag list, retention release, warranty to Service Case, closure checks | 3 |

Each phase is one or more PRs. The owner sees each on the staging preview before merge.

## 3. Catalog (phase 1)

### Category tree (two levels)

| Group (code) | Sub-categories | Stage | Photo |
|---|---|---|---|
| Works `WORKS` | Hacking, Masonry/Tiling, Waterproofing, Plumbing, Electrical, Plaster ceiling, Painting, Aluminium/Glass, Flooring, Aircon install, Cleaning, Protection, Project management | Hardware | not used |
| Built-in `BUILTIN` | Kitchen cabinet, Wardrobe, TV cabinet, Shoe cabinet, Study table, Countertop (stone), Shelving | Furniture | required |
| Furniture `FURNITURE` | Sofa, Bedframe, Mattress, Dining, Tables, Loose storage | Furniture | required |
| Lighting `LIGHTING` | Downlight, Pendant, LED strip, Ceiling fan | Hardware (installed by electrician) | required |
| Appliances `APPLIANCE` | TV, Fridge, Washer, Water heater, Hood/hob, Aircon unit | Appliances | required |
| Soft furnishing `SOFT` | Curtain/Blinds, Bed linen, Amenities, Decoration, Carpet, Diffuser | Soft furnishing | required |
| Service `SERVICE` | Delivery, Styling, Photoshoot, Airbnb setup | Soft furnishing | not used |

- The group decides the default stage of a line. Sub-category of a Works item is the trade:
  it names the subcontractor scope, the PO split and the project trade task.
- Existing furniture categories map into `FURNITURE` / `SOFT` (SOFA, BEDFRAME, MATTRESS,
  DINING -> FURNITURE; BEDLINES, CARPET, DIFFUSER -> SOFT; ACCESSORY, FABRIC_ACCESSORY ->
  FURNITURE "Accessory"; SERVICE -> SERVICE). The `mfg_product_category` enum is kept and
  only extended; nothing stored is renamed.
- Room is NOT a category. Room lives on the document line (`location`).

### UOM list
`PCS`, `UNIT`, `SET`, `LOT` (lump sum, prints "LS"), `FT` (run), `SQFT`, `POINT`, `FULL`
(prints "FULL UNIT"). Works are priced supply-and-install, so no bag/tin units.

### Photos
Photos move to the SKU (one primary + gallery, R2, same pipeline as model photos).
Required for BUILTIN/FURNITURE/LIGHTING/APPLIANCE/SOFT before the SKU can be ACTIVE;
not used for WORKS/SERVICE. Quotation and SO prints show the primary photo where the
print format asks for it.

### Binding
Each SKU binds one main supplier (subcontractors are suppliers too) with cost. The binding
pre-fills the line's supplier and cost; the PO split groups by it. A line may override it.

## 4. Sales documents (phase 2)

### Shared line structure (Quotation, SO, VO)
- Header: brand (Dream Crafter / The Conts letterhead), customer (owner or customer),
  building, unit, prepared by, date, revision / last amended, payment-term template,
  project id.
- Sections: free heading ("CARPENTRY WORK @ KITCHEN AREA"), sort order, colour band,
  optional section lump-sum price (children then print without prices).
- Lines: parent line, child lines (add-ons such as soft-close drawer, LED casing),
  description lines (dimensions "W : 8.2FT X D : 2FT X H : 9.5FT"), room (`location`),
  product (gives category, stage, UOM, cost, supplier), qty (integer), measure (decimal
  + unit, optional), unit price, list price, line discount %, amount, cost (internal),
  supplier, flags: supply-by-owner (install only, no goods PO), FOC (prints "FOC"),
  negative/waived lines allowed.
- Document discount (e.g. showroom discount), promotion text lines, terms, signature block.

### Quotation
Number `QT-YYMM-NNN`, revisions `-R2`, `-R3` (old revisions read-only). Status: Draft ->
Sent -> Accepted / Rejected / Expired. Must belong to a project. Package templates (e.g.
"Skyline Embassy Type A Classic") clone into a new quotation. Converting the accepted
revision copies every line to a new SO, stamps the quotation number on the SO and locks
the quotation.

### Sales order (the contract)
- One project has at most one SO. Header adds original contract sum, VO total, revised
  contract sum, payment schedule with per-instalment billed / received.
- Renovation SOs do not use the furniture fulfilment statuses; status is Confirmed ->
  In progress -> Completed -> Closed, or Cancelled. Progress lives on the project.
- SO -> PO: one click; lines group by supplier; every PO line keeps `so_item_id`.
  Supply-by-owner lines produce no goods PO (labour lines still do).

### Progress billing
New: an SO-based progress invoice (the engine only invoices from DOs today).
Instalment amount = cumulative % x revised contract sum - already billed. Example in
the brainstorm: 100k contract, VO +10k after instalment 2 -> instalment 3 bills 39,500.
A negative result offers a credit note instead.

### VO
Number `VO-<SO no>-NN`. Add lines and omit lines, printed for customer signature. On
approval: add lines append to the SO tagged with the VO number; omit lines reduce or
cancel SO lines and flag the linked PO line for amendment/cancel. Uses the engine's SO
amendment machinery underneath so locks and audit stay consistent.

### Subcontractor / supplier PO payment schedule
Each PO carries instalments (default Mobilise 30-50% / Completion / Retention 5-10%),
editable. Completion becomes payable when the PO is received; retention when the project
is handed over and the snag list is closed.

### Print formats (one document, choose at print)
Match the owner's sample PDFs (Dream Crafter AVA / D'Clover, The Conts Skyline / KL 48):
1. Amount only: No / Description / Qty / Amount, page subtotal, grand total.
2. Unit price: No / Description / Qty / Unit price / Amount.
3. Discount detail: Qty / Disc price / Disc % / Amount; summary Total -> Discount -> Final total.
4. Qty only: No / Description / Qty, one package total.
5. Promotion vs standard: two price columns + Qty; total at promotion price.
All: letterhead by brand, company block, Attention/To + Prepared by/Building/Unit/Date,
LAST AMEND date, intro sentence, section colour bands, measure printed as "42.6FT",
"LS", "1 SET", "FULL UNIT", footer bank line and terms, last page payment terms with
instalment descriptions and two signature blocks. A4 portrait. Built on the engine's
`printDocumentPdf` / `PrintPreviewModal` pipeline.

## 5. Project (phase 3)

### Stages
Design -> Key collection & permit -> Defect check -> Site measure & shop drawings ->
Hardware works -> Furniture & built-in -> Appliances -> Soft furnishing / Airbnb setup ->
Cleaning & handover -> Warranty -> Closed.
`Signed` is an event (SO confirmed + first instalment received) and may happen before or
after shop drawings.

Stage state: not started / in progress / done / skipped.
- Auto-skip from SO contents: no FURNITURE/BUILTIN lines -> Furniture skipped; no
  APPLIANCE -> Appliances skipped; no SOFT/SERVICE -> Soft furnishing skipped; no WORKS ->
  Hardware skipped. A VO adding such lines re-opens the stage.
- Manual skip of a stage or checklist item requires a reason; actor and time are logged.
- A billing instalment tied to a skipped stage moves to the next stage that is not skipped.

### Hard gate
Hardware works cannot start until: SO confirmed, instalment 1 received, shop drawings
signed, renovation permit approved (or skipped with reason).

### Per-stage checklist (template, editable per project type)
| Stage | Items | Evidence |
|---|---|---|
| Design | brief, layout, 3D, quotation revisions | drawings, quotation |
| Key & permit | key/access-card count, renovation permit, renovation deposit, worker passes | permit, deposit receipt |
| Defect check | inspect per room, submit to developer, follow up, re-inspect | defect report with photos |
| Shop drawings | site measure, carpentry/electrical/ceiling drawings, material & colour selection, customer sign-off (max 3 amendments) | drawings, colour sheet, signature; triggers factory PO |
| Hardware | trade tasks generated from SO WORKS sub-categories in fixed order (protection, hacking, plumbing, electrical 1st fix, ceiling, painting, electrical 2nd fix, flooring); per task: subcontractor, PO, planned/actual dates, before/after photos | completion = PO receipt |
| Furniture & built-in | cabinet delivery & install, stone top measured after cabinets, curtains, loose furniture | site receipt POD |
| Appliances | delivery, install, power test | site receipt POD, test tick |
| Soft / Airbnb | linen, amenities, styling, photoshoot | site receipt POD, photos |
| Handover | cleaning, internal QC, customer walk-through, snag list rectified within 7 days, handover form signed, keys returned, deposit refund | signed handover, snag photos |
| Warranty | complaints become Service Cases | Service Case |

Project templates: Full renovation (all stages), Airbnb package (no hardware/defect),
Carpentry only.

### Billing prompts
The stage that owns an instalment shows "Bill instalment N" when its trigger is met; the
user issues the progress invoice from there.

### POD (proof of delivery / completion)
| Case | Where it is captured | What is captured |
|---|---|---|
| Supplier delivers straight to site (most furniture, appliances, factory cabinets) | Site receipt on the phone = the PO's goods receipt, done by the site supervisor at the unit | photos of items in place, photo of the supplier's DO, received qty per line, signature (supervisor; customer optional), GPS, time |
| We deliver from our warehouse to site | Engine delivery order + existing `MobilePOD` | signature, GPS, photo (unchanged) |
| Subcontractor finishes a trade | Completion receipt on the trade PO | before/after photos per room, supervisor confirmation |
| Customer accepts the unit | Handover form on the project | customer signature, snag list closed |

Every POD shows in three places: on its PO/GRN/DO, on the project stage it completes
(grouped by room), and on a printable delivery/completion note. A stage completes only
when every line it owns has a POD.

## 6. Close-out (phase 4)
Project cost sheet from SO lines (budget), PO lines (committed), GRN (received), PV
(paid), progress invoices and receipts (billed/collected); margin budget vs actual.
Closure checks: every SO line has a PO; every PO received; all instalments billed and
collected; every PO paid except retention; every VO signed; snag list closed; warranty
over and retention released; renovation deposit refunded. Red flags list on the project
board until all pass.

## 7. Not in this round
Own work crews, subcontractor bid comparison, Gantt scheduling (only order + delay flags),
CRM beyond a simple lead list.

## 8. Engineering notes
- Engine changes are allowed for this work (owner decision). Keep them in clearly named
  files where possible (`renovation`), and keep Houzs-only code paths working.
- Migrations: `migrations-pg/`, numbered after the open PRs; range 0060-0089 reserved
  for this work (phase 1: 0060-0064, phase 2: 0065-0074, phase 3: 0075-0084).
- Money in integer sen; `measure` stored as numeric with 3 decimals.
- Every gate and lock fails closed if its read fails.
