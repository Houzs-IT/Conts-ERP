# Dates, categories and the production module (owner, 1 Nov 2026)

Status: agreed direction, phases 1 to 3 not built yet. Phase 0 shipped with this document.

## Owner decisions (1 Nov 2026, in his words where it matters)

1. Project and its SOs are one record for every shared field (customer, phone, email, address, building, unit,
   layout, built-up...). Editing either side updates the other, whether the SO is signed or not.
2. Client PO is decided by the SKU's supplier: a SKU bound to supplier "Customer" is bought by the client. The
   `CUS-` prefix is not a rule the owner uses.
3. The SO and project dates are the project's Start date and End date. Processing and delivery dates belong to
   each category, sub-category and SKU line, not to the whole SO.
4. Not every SKU has variants; the variant field is shown only where the SKU has variants.
5. The hard-coded Houzs categories (Sofa, Bedframe, Mattress, Accessories) go everywhere: MRP, supplier supply
   category, filters, reports. Everything reads the product catalog's Category + Sub-category.
6. An "In-house Production Team" supplier: works given to our own team (masonry, wiring, plaster ceiling) are
   ordered on a PO to it.
7. A Raw material category.
8. A production module. Flow:
   1. PO to In-house.
   2. One click turns it into a Production Order; its value is that PO.
   3. The Production Order lists the raw materials it needs.
   4. MRP works out the raw materials short and opens raw-material POs to outside suppliers.
   5. The raw materials are delivered to site or warehouse and received (GR).
   6. Actual cost is checked against the PO amount.
   A Production Order has its own processing date (start of work). A line enters MRP only once it has a
   processing date.

## Phase 0 (shipped with this document)

- All shared fields flow project -> every linked SO that is not cancelled (`pushProjectToOpenSos`); SO -> project
  already did. `CustomerInfoCard` no longer says "kept as printed".
- Migrations 0189 / 0190: product group RAW "Raw material" with nine sub-categories (cement & sand, tile adhesive,
  gypsum & board, timber, wire & electrical fittings, pipe & plumbing fittings, paint & sealant, hardware, other),
  item group RAW, and supplier INHOUSE "In-house Production Team". Applied to production 1 Nov 2026.
- Client PO: the code already decides by the line's supplier, else the SKU's main supplier = CUSTOMER. The
  `CUS-` fallback only acts when a SKU has no supplier at all; on 1 Nov 2026 all 62 CUS- SKUs are bound to
  CUSTOMER and no other SKU is, so the result is the same. Removing the fallback is part of phase 1.

## Phase 1: dates and categories (about 2 to 3 days)

- SO header `processing_date` / `customer_delivery_date` are shown and edited as Project start / Project end and
  kept equal to the project's start / end (both directions, like the shared fields).
- Line dates: `mfg_sales_order_items.line_date` (processing) and `line_delivery_date` stay the per-line dates; the
  PO tab already sets them per category, sub-category and line. A line can be put on a PO, and appears in MRP,
  only when it has a processing date.
- MRP tabs, supplier "supply category" and every filter read `scm.product_category_groups` /
  `scm.product_sub_categories` instead of the Houzs list. 107 source files name SOFA / BEDFRAME / MATTRESS /
  ACCESSORY (53 in backend scm, 44 in frontend pages and vendor); each is either switched to the catalog or kept
  as a Houzs-only path where Conts never reaches it. The enum `mfg_product_category` keeps the old values (Postgres
  cannot drop them); nothing new is stored with them.
- Variants: the PO tab and PO print show the variant field only for a SKU that has variants.
- PO tab: PO numbers link to the PO like DO and GR already do; columns can be moved.

## Phase 2: production module (about 1 to 2 weeks; design to be shown to the owner before building)

Data (new migrations):
- `scm.production_orders`: id, doc_no (TC-PRO-YYMM-NNN), company_id, source_po_id (the PO to INHOUSE, unique),
  project_id, so_doc_no, status (PLANNED, IN_PROGRESS, DONE, CANCELLED), processing_date (start of work),
  target_date, amount_sen (= the PO), actual_cost_sen, notes, audit columns.
- `scm.production_order_lines`: the PO's lines (works) copied at conversion.
- `scm.production_order_materials`: raw material SKU (group RAW), qty needed, uom, qty ordered, qty received,
  unit cost; optional link to the raw-material PO line that buys it.

Flow:
- A PO whose supplier is INHOUSE gets "Convert to production order" (once). The PO itself never goes to an outside
  supplier and posts no payable; its value becomes the production order's budget.
- MRP reads two demands: SO lines with a processing date (as today, by catalog category) and production-order
  materials with the production order's processing date. Shortages become raw-material POs to the materials'
  suppliers, delivered to site or warehouse, received by GR as today.
- Actual cost = received raw-material cost (+ labour later); the production order shows actual vs budget.

Screens: Production > Production orders (list, detail with works, materials, linked POs / GRs, cost); MRP gets a
Raw material tab from the catalog; the PO detail shows the production order it became.

## Owner answers (1 Nov 2026, later the same day)

- Actual cost counts raw materials only for now; labour cost is adjusted later.
- Nobody converts by hand: a production order is created automatically when a PO to INHOUSE is issued (and
  follows it: a cancelled PO cancels its production order while nothing has been ordered for it).
- Reference: Hookka ERP (`weisiang329-eng/hookka-erp-testing`, read-only). It is a full furniture factory
  (one production order per confirmed SO item created upstream, BOM-driven job cards per department, shop-floor
  scans, a cost ledger, MRP persistence with on-order and MOQ in migrations 0112 / 0230). Conts takes the shape,
  not the weight: the production order is created upstream automatically like Hookka's, materials come from a
  per-SKU material list (a light BOM: works SKU -> raw material SKU x qty per unit) that can be edited on the
  order, MRP nets stock and what is already on order like Hookka's, and actual cost is the received raw-material
  cost. No departments, job cards or scans.
