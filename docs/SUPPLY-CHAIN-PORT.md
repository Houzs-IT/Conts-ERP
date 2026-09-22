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

## Nav shape (target)

New top-level **SUPPLY CHAIN** group (replaces the interim PROCUREMENT group once
Tier 1 lands), children: Sales Order · Consignment · Procurement · Transportation ·
Warehouse — mirroring Houzs.

## Sequence & status

Dependency order: masters → procurement docs → warehouse/stock → sales docs →
consignment → transportation → furniture cross-cutting.

### Tier 0 — Masters (mostly independent; parallelizable)
- [x] **Products / SKU master** — PR #25 `feat/products-maintenance` (HELD: migration 0006)
- [ ] Product Models (`ProductModels`, `ProductModelDetail`) + allowed-options
- [ ] Categories (`Categories`)
- [ ] Suppliers / creditors (`Suppliers`, `SupplierDetail`)
- [ ] Warehouses + racks (`Warehouses`, `WarehouseRacks`)
- [ ] Currencies (`Currencies`) — only if multi-currency is kept

### Tier 1 — Procurement (buy-side documents)
- [ ] Purchase Orders (`PurchaseOrders*`, `PurchaseOrderNew/Detail`, `PoAmendments`)
- [ ] Goods Received / GRN (`GoodsReceived*`, `GrnFromPo`, `GrnNew`)
- [ ] Purchase Invoices (`PurchaseInvoices*`, `PurchaseInvoiceFromGrn`)
- [ ] Purchase Returns (`PurchaseReturns*`)
- [ ] Purchase Consignment (`PurchaseConsignmentOrders/Receives/Returns`)
- [ ] Payment Vouchers (`PaymentVouchers*`) + Outstanding

### Tier 2 — Warehouse / Stock
- [ ] Inventory / Stock Card (`Inventory`, `StockCard`)
- [ ] Stock Adjustments / Takes / Transfers (`Stock*`)

### Tier 3 — Sales (sell-side documents)
- [ ] Sales Orders (`SalesOrder*`, `MfgSalesOrdersList`, `SoFromProducts`, guided/new)
- [ ] Delivery Orders (`DeliveryOrder*`, `DeliveryOrderFromSo`) + Returns
- [ ] Sales Invoices (`SalesInvoice*`, `SalesInvoiceFromDo`) + `UnbilledDeliveries`

### Tier 4 — Consignment (sell-side)
- [ ] Consignment Notes / Orders / Returns (`Consignment*`)

### Tier 5 — Transportation / TMS
- [ ] Fleet / Lorry / Drivers (`Fleet*`, `Lorry*`, `Drivers`, `DriverLeave`)
- [ ] Delivery planning (`DeliveryPlanning*`, `DeliveryZones`, `DeliveryRateCards`,
      `DeliveryResidenceRules`, `AutoSchedule`, `DpOrders`, `Trips`)
- [ ] 3PL (`ThreePLCompanies`), `DeliveryMaintenance`

### Tier 6 — Furniture-specific & cross-cutting
- [ ] MRP (`Mrp`) · Fabric tracking (`FabricTracking`)
- [ ] HR commission/settings (`HrCommission`, `HrSettings`)
- [ ] Accounting (`Accounting`), Fair report (`FairReport`)
- [ ] Shared: `DataGrid`, `DocumentFlowModal`, `EntityHistoryPanel`, doc-relationship map

## Notes

- Conts is a property **operator**. Sell-side flows (Sales/Consignment) are ported
  1:1 per the owner's decision; if a flow proves genuinely unused it is a candidate
  to hide (not delete) later — flagged, not assumed.
- `V2`/non-V2 duplicates in Houzs: port the **V2** where both exist (the current UI).
