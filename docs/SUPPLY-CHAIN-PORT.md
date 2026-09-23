# Supply Chain port — Houzs → Conts

**Goal (owner, 2026-09-22):** port the **entire** Houzs "Supply Chain" module into
Conts, 1:1, furniture-specific flows included. Delivered **module by module, each
as its own verified PR**, in dependency order.

**Source of truth (Houzs):**
- Frontend: `houzs-work/frontend/src/pages/scm-v2/` (163 pages, ~115k LOC) +
  `houzs-work/frontend/src/vendor/scm/` (195 files, ~46k LOC).
- Backend: `houzs-work/backend/src/scm/{routes,lib,middleware,shared}` — the
  endpoint + business-logic reference. **Not** copied verbatim: Houzs runs a Node
  backend; Conts is Cloudflare Pages Functions (`functions/api/**`) over Postgres
  (`pos` schema via Hyperdrive). Each route is re-implemented in the Conts idiom.

## Two hard rules (owner, 2026-09-22)

1. **Follow 2990's (Co2) rules, not Houzs's (Co1).** Houzs's `scm-v2` + `vendor/scm`
   is **2990's SCM vendored into Houzs** (see the `Scm2990Shell` header — it wraps a
   vendored 2990 page tree). Port the **vendored 2990 business logic** — document
   flows, statuses, validations, numbering. Do NOT carry over Houzs host-side
   overrides (its shell wiring, auth, branding). Where a page branches on company,
   take the **2990** path. Cross-reference the standalone 2990s repo
   (`2990s-Portal/2990s`, `wenwei4046/2990s`) only when a vendored rule is ambiguous.
2. **Skin to Conts's own design system — never Houzs's or 2990's colours.** Colours
   come only from `src/styles/tokens.css` / `src/lib/design-tokens.ts`; status via
   `TONE`; **gold = identity, black = selection, never a status**; no hardcoded hex in
   a page. **Do NOT port `vendor/scm` components 1:1** (DataGrid, dialogs, line cards,
   grids) — re-implement the behaviour with Conts `Card`/`Button`/`Field`/`Drawer`/
   `Badge`/`Icon`. Port the *logic*, draw the *UI* in Conts.

## Porting conventions (every module follows these)

- **DB:** `pos` schema, `TEXT`+`CHECK` enums, money integer **sen**, dates ISO
  `TEXT`, unique business codes, `owner to pos_app` + RLS sweep in each migration.
- **Backend:** `functions/_lib/db.ts` (`all/one/run/json/fail/audit/nowIso`, `?`
  placeholders); `requireSession`/`canSeeFinance` (`_lib/auth.ts`); writes gated on
  `MASTER_ROLES` (`_lib/properties.ts`); cost/price finance-gated; audit every write.
- **Frontend:** `useApi(path, FALLBACK)` + `api`; `PageHeader`/`Card`/`Button`/
  `Field`/`Drawer`/`Icon`; `TONE`/`cx`; `rm()` money. **Black = selection, gold =
  identity (never a status).** Lazy route in `App.tsx`; nav entry in `navigation.ts`.
- **Verify each PR:** `tsc --noEmit` + `vite build` clean, render at desktop +
  mobile via the DEV fallback. **Migrations HOLD merge** until the prod DB batch is
  applied (Conts merge = instant prod deploy, no PR CI).

## Nav shape — DONE (PR #47)

**SUPPLY CHAIN** group (L1) with collapsible L2 sections → L3 pages, mirroring Houzs
(owner ask "module buttons must match, L1/2/3"). L2: **Procurement · Warehouse · Sales ·
Consignment · Transportation · Furniture · Accounting**, each holding its pages. Uses
Conts's collapsible-nav idiom (same as Reservations/Operations/Properties). Verified rendering.

## Sequence & status

Dependency order: masters → procurement docs → warehouse/stock → sales docs →
consignment → transportation → furniture cross-cutting.

### Tier 0 — Masters (mostly independent; parallelizable)
- [x] **Products / SKU master** — PR #25 `feat/products-maintenance` (HELD: migration 0006)
- [x] **Suppliers** — PR #28 `feat/scm-suppliers` (stacked on #25; HELD: migration 0007). Bindings + scorecard deferred to materials/PO tiers.
- [x] **Product Models** — PR #29 `feat/scm-product-models` (stacked on #28; HELD: migration 0008). Deep variant/allowed-options editor deferred to Variants tier.
- [x] **Categories** — PR #30 `feat/scm-masters` (stacked on #29; HELD: migration 0009)
- [x] **Warehouses** — PR #30 (HELD: migration 0010). Racks deferred to Warehouse-ops tier.
- [x] **Customers** — PR #55 `feat/scm-customers` (stacked on #42; HELD: migration 0025). Sell-side debtor master; SO can reference it going forward. Bindings/credit-hold deferred.
- [ ] Currencies (`Currencies`) — only if multi-currency is kept (likely skip; Conts is MYR-only)

**Tier 0 masters: DONE** (Products, Suppliers, Product Models, Categories, Warehouses).
Shared helper `functions/_lib/scm-util.ts` now exists for the remaining modules.

### Tier 1 — Procurement (buy-side documents)
- [x] **Purchase Orders** — PR #32 `feat/scm-purchase-orders` (stacked on #30; HELD: migration 0011). Core priced PO + status flow; sofa-specials/MRP/SO-linkage deferred. `PoAmendments` = a later slice.
- [x] **Goods Received / GRN** — PR #33 `feat/scm-goods-receipts` (stacked on #32; HELD: migration 0012). Receives against a PO, drives PO status; cancel reverses.
- [x] **Purchase Invoices** — PR #35 `feat/scm-purchase-invoices` (stacked on #33; HELD: migration 0013). Bills a GRN; payments via Payment Vouchers. **PO→GRN→PI spine complete.**
- [x] **Payment Vouchers** — PR #39 `feat/scm-payment-vouchers` (stacked on #35; HELD: migration 0014). Pays PIs, drives paid status. **PO→GRN→PI→Payment loop complete.**
- [x] **Purchase Returns** — PR #40 `feat/scm-purchase-returns` (stacked on #39; HELD: migration 0015). Returns GRN goods, reverses received_qty + PO status.
- [x] **Purchase Consignment** — PR #41 `feat/scm-purchase-consignment` (stacked on #40; HELD: migration 0016). Consignment **order** ported; receives/returns = follow-up sub-slice. **TIER 1 DONE.**

**Buy-side procurement DONE:** masters + PO → GRN → PI → Payment + Returns (only
Purchase Consignment left in Tier 1). Migrations 0006–0015. Merge order:
#25→#28→#29→#30→#32→#33→#35→#39→#40.

### Tier 2 — Warehouse / Stock
- [x] **Stock ledger + on-hand** — PR #42 `feat/scm-stock` (stacked on #41; HELD: migration 0017). Movements ledger + on-hand + manual adjustment. FIFO cost deferred.
- [x] **GRN/DO → stock auto-wiring** — PR #58 `feat/scm-stock-wiring` (stacked on #55; HELD: migration 0026). GRN receive posts RECEIPT +qty; DO deliver posts ISSUE -qty; cancel reverses. Shared `postStockMovement` helper. Warehouse picker (optional) in both create drawers. Live posting UNTESTED until 0026 applied.
- [x] **Purchase Returns → stock** — PR #62 `feat/scm-returns-stock` (stacked on #58; no migration). Return posts RETURN -qty out of the GRN's warehouse; cancel reverses. Backend-only.
- [x] **Stock Transfers + Stock Takes** — PR #54 `feat/scm-stock-ops` (stacked on #51; HELD: migration 0024). Transfer between warehouses (posts paired out/in movements); stock take counts + variance posting. StockCard = the movements view (done). **TIER 2 DONE.**

### Tier 3 — Sales (sell-side documents)  — **SPINE DONE (SO→DO→SI)**
- [x] **Sales Orders** — PR #43 `feat/scm-sales-orders` (stacked on #42; HELD: migration 0018). 9-state flow + deposit/payment; customer inline (customers master = follow-up); guided/from-products/margins/MRP-gate deferred.
- [x] **Delivery Orders** — PR #44 `feat/scm-delivery-orders` (stacked on #43; HELD: migration 0019). Delivers a SO, drives delivered_qty + SO→DELIVERED; POD/signature deferred. Delivery Returns = follow-up.
- [x] **Sales Invoices** — PR #45 `feat/scm-sales-invoices` (stacked on #44; HELD: migration 0020). Bills a DO, marks DO/SO INVOICED, receipts drive paid status. UnbilledDeliveries = follow-up.
- [x] **Sales Returns** — PR #63 `feat/scm-sales-returns` (stacked on #62; HELD: migration 0027). Customer returns DO-delivered goods: reduces SO delivered_qty, posts RETURN +qty into the dispatch warehouse, credit-note value; cancel reverses. Adds delivery_order_lines.returned_qty. Sell-side twin of Purchase Returns.
- [x] **Unbilled Deliveries** — PR #65 `feat/scm-unbilled-deliveries` (stacked on #63; no migration). Read-only AR report: dispatched DOs with no active SI + uninvoiced total + aging.

### Tier 4 — Consignment (sell-side)
- [x] **Consignment Notes** — PR #51 `feat/scm-consignment-notes` (stacked on #49; HELD: migration 0023). Consign out; track consigned/sold/returned + settle. Orders/Returns variants = follow-up.

### Tier 5 — Transportation / TMS
- [x] **Drivers + Vehicles masters** — PR #46 `feat/scm-transport` (stacked on #45; HELD: migration 0021). New TRANSPORT nav group. DriverLeave / Fleet run-sheets / Lorry capacity = follow-up.
- [ ] Delivery planning (`DeliveryPlanning*`, `DeliveryZones`, `DeliveryRateCards`,
      `DeliveryResidenceRules`, `AutoSchedule`, `DpOrders`, `Trips`)
- [ ] 3PL (`ThreePLCompanies`), `DeliveryMaintenance`

### Tier 6 — Furniture-specific & cross-cutting
- [x] **MRP** — PR #48 `feat/scm-mrp` (no migration). Demand − on-hand − on-order = net to buy.
- [x] **Fabric library** — PR #47 `feat/scm-furniture-modules` (migration 0022).
- [x] **Accounting** — PR #49 `feat/scm-accounting` (no migration). AP + AR outstanding, finance-gated.
- [ ] HR commission/settings (`HrCommission`, `HrSettings`) — furniture sales-rep specific
- [ ] Fair report (`FairReport`) · shared `DataGrid`/`DocumentFlowModal`/`EntityHistoryPanel`

---

## STATUS: entire Supply Chain surface ported (26 modules, PRs #25–#65)

All five Houzs SC sections (Sales · Consignment · Procurement · Transportation · Warehouse)
+ MRP + Fabric + Accounting + Customers + Stock Transfers/Takes + full stock auto-wiring
(GRN/DO/returns) + Sales Returns, in the L1/L2/L3 nav. Migrations 0006–0027. **Merge order:**
#25 #28 #29 #30 #32 #33 #35 #39 #40 #41 #42 #43 #44 #45 #46 #47 #48(no-mig) #49(no-mig) #51
#54 #55 #58 #62(no-mig) #63 #65(no-mig) (+ #26 docs). All stacked, all HELD for their
migrations (except no-mig #48/#49/#62/#65). Tiers 0–4 masters + doc spines complete; Tier 2
warehouse complete; buy/sell returns + stock ledger fully wired; unbilled-deliveries report done.

**Deferred sub-slices** (bounded cores shipped; depth follows as needed):
FIFO cost layers, consignment receives/returns,
delivery planning/zones/rate-cards, driver leave, 3PL, run sheets, fair report, currencies,
amendments, HR commission, furniture line specials (divan/leg/gap/custom/variants),
model variant/allowed-options editor.

## Notes

- **Both apps share the same database family: Supabase Postgres.** Conts reaches it
  through Cloudflare Hyperdrive (a pooler), Houzs/2990 through a Node server — but the
  DB itself is Supabase both sides. So the port's only real incompatibilities are (1)
  the backend **runtime** (Cloudflare Pages Functions vs Node/Hono — different route
  shell) and (2) **data access** (Conts raw SQL via `postgres` vs Houzs Drizzle ORM).
  The SQL logic, schema, fields, statuses and business rules are 1:1. This is why we
  rewrite each file's shell but copy the logic — not because the DB differs.
- Conts is a property **operator**. Sell-side flows (Sales/Consignment) are ported
  1:1 per the owner's decision; if a flow proves genuinely unused it is a candidate
  to hide (not delete) later — flagged, not assumed.
- `V2`/non-V2 duplicates in Houzs: port the **V2** where both exist (the current UI).
