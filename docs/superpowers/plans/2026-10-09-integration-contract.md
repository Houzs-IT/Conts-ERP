# Renovation: integration contract between phases 1, 2 and 3

This file wins over the three phase plans wherever they disagree. Phases run in
parallel on separate branches off `main`, after the foundation PR (this branch) merges.

## Shared code already on main (foundation PR)
| File | Owner | Others |
|---|---|---|
| `engine/backend/src/scm/shared/renovation-catalog.ts` (+ `engine/frontend/src/vendor/shared/` mirror) | phase 1 may extend | import only |
| `engine/backend/src/scm/shared/renovation-stages.ts` (+ mirror) | phase 3 may extend | import only |
| `engine/scripts/coverage-areas.mjs` | restored from Houzs c20343f5 so engine vitest runs | - |
| `engine/backend/src/scm/shared/renovation-money.ts` (+ mirror) | phase 2 creates | phase 3 imports |

Mirrors are byte-identical; `renovation-shared.canonical.test.ts` enforces it.

## Names
- Category groups (stored in `mfg_products.category` for new SKUs): `WORKS, BUILTIN, FURNITURE, LIGHTING, APPLIANCE, SOFT, SERVICE`.
- Product columns (phase 1): `mfg_products.category_group`, `mfg_products.sub_category`, `mfg_products.uom`. The trade of a WORKS line is its product's `sub_category`.
- Stage keys (lower case, everywhere, including `product_category_groups.default_stage`): `design, key_permit, defect_check, shop_drawings, hardware, furniture, appliances, soft_furnishing, handover, warranty, closed`. Phase 1's upper-case `HARDWARE|...` codes are replaced by these.
- Trade order: `TRADE_ORDER` in `renovation-stages.ts` is a SUGGESTED layout order only; never enforce it (no "previous task must finish" rule). Phase 1's WORKS seed `sort_order` follows it. WORKS sub-categories include `GRILL` and `TEXTURED_PAINTING`; `ALUMINIUM_GLASS` covers window / sliding door / glass.
- Template tasks: `INTERNAL_TASKS` in `renovation-stages.ts` (pre-reno delivery, QC, post reno cleaning, touch up, set up cleaning, joint handover inspection). Phase 3 stores them in `project_trade_tasks` with `trade_code = 'INTERNAL:<key>'` and no PO.
- Fulfilment: every trade task today links to a PO (`purchase_order_id`). Phase 3 adds `fulfilment_kind text not null default 'po' check (fulfilment_kind in ('po','internal'))`; a later Production module adds `'production_order'` and its link column. Do not build production orders now.
- Derived board conditions (phase 3, read-time): furniture condition over lines whose group is FURNITURE/BUILTIN/APPLIANCE/SOFT/LIGHTING, reno item condition over WORKS lines with goods: `pending_purchased` (some live line has no live PO line), `pending_arrived` (all have PO lines, some not fully received by GRN/site receipt/DO), `all_arrived`.
- Calendar: phase 3 adds `GET /api/renovation/calendar?from=&to=&supplierId=&projectId=` and a calendar page inside the Projects area; tasks have `planned_start`/`planned_end`; drag updates them through `PATCH /trade-tasks/:id`.
- SO line structure lives in phase 2's side tables, not on `mfg_sales_order_items`:
  - `scm.reno_doc_lines` (kind ITEM/CHILD/DETAIL/TEXT, `parent_line_id`, `room`, `qty`, `measure`, `measure_uom`, `is_foc`, `supply_by_owner`, `supplier_id`, `so_item_id`, `vo_id`, `vo_change`, `omitted_by_vo_id`) under `scm.reno_doc_sections` (owner `so_doc_no` for a contract).
  - Phase 2 adds `stage_code text null` to `scm.reno_doc_lines` (an override of the product's default stage; values are stage keys).
  - Phase 3 reads a contract's lines as: `reno_doc_lines` (owner SO, kind ITEM/CHILD, not `omitted_by_vo_id`) joined to `mfg_sales_order_items` on `so_item_id` (`cancelled = false`) joined to `mfg_products` on `item_code` for `category_group`, `sub_category`.
- Renovation SO: `mfg_sales_orders.so_kind = 'RENOVATION'`; statuses `RENO_CONFIRMED`, `RENO_IN_PROGRESS`, `RENO_COMPLETED`, then `CLOSED` / `CANCELLED`. Phase 3's gate treats "SO confirmed" as status in (`RENO_CONFIRMED`, `RENO_IN_PROGRESS`, `RENO_COMPLETED`). One live renovation SO per project (`uq_mfg_so_reno_project`).
- Customer instalments: phase 2's `scm.reno_doc_instalments` (`seq, label, pct_bp, description, stage_code`). Phase 2 also adds `trigger text not null default 'stage_start' check (trigger in ('so_confirmed','stage_start','stage_done'))`. Billed and received amounts come from phase 2's `billingView(sb, soDocNo)` in `scm/lib/renovation-billing.ts`; phase 3 calls it (or reads `scm.reno_instalment_bills` + the SO's sales invoices in SQL with the same rule). Phase 3 never stores its own copy of amounts. There is no `scm.so_payment_instalments` table.
- Billing action: `POST /api/scm/renovation/sales-orders/:docNo/instalments/:id/bill {invoiceDate, expectedAmountSen}` (phase 2). Phase 3's prompt banner calls it.
- Hooks: phase 2's `scm/lib/renovation-hooks.ts` exposes `onRenovationSoLinesChanged(docNo)` (after-commit registry) and `projectHandoverState(sb, projectId)` returning `'unknown'` until phase 3 replaces the body with a read of `public.project_handovers` (returns `'handed_over' | 'not_handed_over' | 'unknown'`).
- Quotations: `GET /api/scm/renovation/quotations?projectId=` (phase 2). Project existence check from phase 2: `select 1 from public.projects where id = $1` (phase 3 adds `project_kind`; phase 2 must not depend on that column).
- PO lines keep `so_item_id`. Phase 3 links trade tasks through it.
- Routes: phase 2 mounts `/api/scm/renovation` in `engine/backend/src/scm/index.ts`; phase 3 mounts `/api/renovation` in `engine/backend/src/index.ts` and `/api/scm/site-receipts` in `scm/index.ts`. Add separate blocks; do not reorder others.
- Generic SKUs: phase 1 seeds one generic SKU per WORKS and SERVICE sub-category (code `RN-<SUB>`, e.g. `RN-ELECTRICAL`) so every priced line can pick a SKU with free-text description. Phase 2 seeds `RENO-ADJUST`, `RENO-DISCOUNT`, `RENO-PROGRESS` (category `SERVICE`).
- `isServiceLine` (`scm/shared/service-sku.ts`) is not changed: WORKS products are never treated as freight. `RENO-*` SKUs never go on a PO.

## Migration ranges (`migrations-pg/`)
phase 1: 0060-0064, phase 2: 0065-0074, phase 3: 0075-0084. Every new table: `OWNER TO scm_engine`, RLS enabled, revoke from anon/authenticated, `-- REVERSAL:` first line. New enum values in their own file.

## File ownership (avoid two phases editing one file)
| File | Owner |
|---|---|
| `Products.tsx`, `mfg-products.ts`, `suppliers.ts`, `PhotoGallery.tsx`, `public-images.ts`, `category-badges.tsx` | phase 1 |
| `mfg-purchase-orders.ts`, `po-grouping.ts`, `so-terminal-states.ts`, `mfg-sales-orders.ts`, `sales-invoices.ts`, `services/permissions.ts`, `App.tsx`, `routeManifest.ts`, `Sidebar.tsx`, `SalesOrderDetailV2.tsx` | phase 2 |
| `grns.ts`, `purchase-returns.ts`, `routes/projects.ts`, `services/projects.ts`, `pages/Projects.tsx`, `ProjectMaintenance.tsx`, `MobileApp.tsx`, `GoodsReceivedDetailV2.tsx`, `backend/src/index.ts` | phase 3 |
| `engine/backend/src/scm/index.ts` | phase 2 and 3, separate appended blocks only |
| `TODO.md` | append one line per open item; rebase on conflict |

Phase 3 needs routes in the engine SPA: it adds them inside `pages/Projects.tsx` / existing project routes, not in `App.tsx`. If a new top-level route is unavoidable, it goes in after phase 2 merges.

## Owner questions: defaults used until he answers
| # | Question | Default |
|---|---|---|
| 1 | Sample PDFs have totals that are not measure x rate (42.6FT x 35 printed 1,065; KL 48 sums 14,600, prints 14,200) | measure x rate is the rule; a line may carry a typed amount override, flagged on screen |
| 2 | Fractions of a sen in discounted unit prices | round each line to the sen |
| 3 | Quotation number prefix | `QT-YYMM-NNN` |
| 4 | Default PO payment split | Mobilise 30 / Completion 65 / Retention 5 |
| 5 | Every priced line picks a SKU | yes, generic `RN-<SUB>` SKUs exist |
| 6 | Credit note account for a negative instalment | group's sales-return account |
| 7 | Supply-by-owner: goods no PO, install labour still PO | yes |
| 8 | Format 5 promotion column | unit price |
| 9 | Site trade order | `TRADE_ORDER` |
| 10 | Site supervisor role | office role with Projects edit |
| 11 | Hide Combo Pricing / Variants / Maintenance tabs too | keep visible |
| 12 | Photo rule for legacy furniture categories | no |
