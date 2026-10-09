# Phase 1 (Catalog) implementation plan

Spec: `docs/superpowers/specs/2026-10-09-renovation-flow-design.md` section 3.

## Findings that shape the plan
1. `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction (`scripts/migrate-pg.mjs:54-57` wraps each file in `sql.begin`), so 0060 is enum-only.
2. Two enums carry the category list: `scm.mfg_product_category` (0044:47) and `public.mfg_product_category` (0045:26); `scm.acc_register_item_group` (0044:6149-6171) needs both in step.
3. SKU list returns ACTIVE only (`mfg-products.ts:199`) with a 60s private cache (`:255`); SKU Master needs `?status=all` with `no-store`.
4. Model gallery images go through authed `/api/scm/*`; only `scm/routes/public-images.ts` (mounted `index.ts:356`) is public. SKU photos must be served from there.
5. New SKUs enter ACTIVE on several Houzs paths (`mfg-products.ts:342`, batch `:590`, `product-models.ts:652,1028`).
6. One main supplier per SKU is app-enforced only (`idx_smb_main_per_material` 0044:6092 not unique; batch create `suppliers.ts:747` does not demote).
7. Sales invoices refuse an `item_group` without a `scm.acc_item_groups` row; SO lines take `item_group = category.toLowerCase()` (`mfg-sales-orders.ts:3318`).
8. Tables created after 0047 are owned by `postgres`; each new table needs `owner to scm_engine` + grants (pattern 0044:9832-9835).
9. `engine/backend/vitest*.mts` import `../scripts/coverage-areas.mjs`, which is missing in this copy; `node_modules` not installed.
10. New group codes do not contain the substrings ~80 readers test (`sofa`, `bedframe`, `mattress`, `accessor`, `dining`, `service`).

## Decisions
- `category` holds the group for new SKUs; new `sub_category` holds the sub-category. Legacy rows are not renamed; `category_group` (trigger-filled) maps them: SOFA/BEDFRAME/MATTRESS/DINING/ACCESSORY/FABRIC_ACCESSORY/OTHERS -> FURNITURE, BEDLINES/CARPET/DIFFUSER -> SOFT, SERVICE -> SERVICE.
- Tree defined once in `renovation-catalog.ts` (backend + byte-identical frontend mirror) and in DB tables; a parity test compares them.
- FK `(category_group, sub_category)` -> `product_sub_categories(group_code, code)`.
- Photo rule keyed on stored `category` in a photo-required group (legacy values exempt).
- `uom` column, CHECK in (PCS, UNIT, SET, LOT, FT, SQFT, POINT, FULL), default UNIT.
- Stage codes for phase 3: `HARDWARE | FURNITURE | APPLIANCES | SOFT_FURNISHING`.

## DB (`migrations-pg/`)
- `0060_renovation_category_enum.sql`: add WORKS, BUILTIN, FURNITURE, LIGHTING, APPLIANCE, SOFT to both enums. REVERSAL: none possible; harmless once 0061-0063 reversed.
- `0061_renovation_category_tree.sql`: `scm.product_category_groups` (code pk, label, default_stage, photo_required, sort_order; 7 seed rows), `scm.product_sub_categories` (pk group_code+code, unique code, legacy_categories text[], active; seed per spec, WORKS sorted in trade order PROTECTION, HACKING, PLUMBING, ELECTRICAL, PLASTER_CEILING, PAINTING, then rest); functions `scm.mfg_category_group(text)`, `scm.mfg_legacy_sub(text)`; columns `category_group`, `sub_category`, `uom` on `scm.mfg_products`; backfill, null guard, constraints, `scm.mfg_products_category_fill()` trigger; indexes; `scm.acc_item_groups` rows for the 6 groups; RLS/owner/grants; `notify pgrst`. REVERSAL listed in file.
- `0062_mfg_product_photos.sql`: `scm.mfg_product_photos` (as `product_model_photos` with `product_id` FK cascade), unique primary per product; backstop trigger `scm.mfg_products_photo_gate()`. REVERSAL: drop trigger, function, table.
- `0063_supplier_binding_one_main.sql`: guard + `uq_smb_one_main` unique partial index. REVERSAL: drop index.
- 0064 spare.

## BE (`engine/backend/src`)
- New `scm/shared/renovation-catalog.ts` (+ mirror `engine/frontend/src/vendor/shared/renovation-catalog.ts`): groups, sub-categories, UOMs, `categoryGroupOf`, `subCategoriesOf`, `legacySubOf`, `isPhotoRequiredCategory`, `validateCategoryPair`, `isUom`, `uomPrintLabel`.
- `scm/shared/product-categories.ts:14-28` (+ mirror): append the six codes and labels.
- `scm/routes/mfg-products.ts`: list filters `group`, `sub`, `status=all`, `withPhotos`, `withMain`; extract `createMfgProductHandler` with category-pair + UOM validation and INACTIVE for photo-required; PATCH accepts `subCategory`/`uom`, photo check on activate (409 `photo_required`, 503 on read error); batch import sub_category/uom; delete cleans R2 photos; register photo routes.
- New `scm/routes/mfg-product-photos.ts` (from `product-models.ts:1237-1518`): keys `mfg-product-photos/<productId>/<uuid>.<ext>`, last-photo refusal, `mfgProductPhotoProxyHandler`.
- `scm/routes/public-images.ts:44-46`: public `/mfg-products/:id/photo/:key`.
- `scm/lib/model-category-move.ts`: optional `subCategory`.
- `scm/routes/suppliers.ts`: first binding becomes main; batch demotes; 23505 -> 409 `main_supplier_conflict`.
- New `scm/lib/default-supply-party.ts`: `resolveDefaultParty(bindings)` (used by phase 2).

## FE (`engine/frontend/src`)
- New `conts/catalog.ts`: `CONTS_RENOVATION_CATALOG`, hidden tabs (`modular`, `fabric`, `categories`), hidden maintenance key `fabrics`, `visibleProductTabs`.
- `pages/scm-v2/Products.tsx`: hidden `?tab` falls back to `sku`; tab array filtered (no code deleted); SKU Master group/sub chips, new-SKU drawer, renovation columns, drawer category picker + photo section.
- New under `pages/scm-v2/products/`: `CatalogChips.tsx`, `CatalogCategoryPicker.tsx`, `UomSelect.tsx`, `RenovationNewSku.tsx`, `SkuPhotoSection.tsx`, `renovationSkuColumns.tsx`.
- `components/scm-v2/PhotoGallery.tsx`: props `{modelId} | {productId}`.
- `vendor/scm/lib/mfg-products-queries.ts`: row fields and query params.
- `vendor/scm/lib/category-badges.tsx`: six swatches.
- `products-import-headers.ts`: `sub category`, `uom` aliases.
- `AddSupplierBinding.tsx`: default main when no bindings.

## Task order (test-first)
0. `npm ci` in engine/backend and engine/frontend; run `npm test`; if vitest fails on missing `scripts/coverage-areas.mjs`, restore it from Houzs commit c20343f5.
1. Shared contract + tests (`renovationCatalog.test.ts`, mirror identity).
2. Migrations 0060-0063 + `renovationCatalogSeedParity.test.ts`; dry-run.
3. Create/PATCH tests (`mfgProductRenovationCreatePatch.test.ts`).
4. List filters.
5. Photo routes + proxy (`mfgProductPhotos.test.ts`, `publicImageMountOrder.test.ts`).
6. Batch import.
7. Bindings + `default-supply-party.test.ts`.
8. FE switch test.
9. FE components (jsdom tests).
10. Products.tsx wiring, badges, browser check.

## Verification
- `cd engine/backend && npm run typecheck && npm test`
- `cd engine/frontend && npm run typecheck && npm test`
- root `npm run build`
- `node scripts/migrate-pg.mjs --dry-run`, then staging (ref `ecgyrmblqfxvbfjlqkdq`)
- Browser at desktop and phone width: only SKU Master / Maintenance / Combo / Variants tabs; group+sub chips; Works SKU active at once; Built-in SKU "Needs photo" until a photo; thumbnails load without 401; first binding becomes main.

## Open questions (defaults used unless the owner says otherwise)
- Q1 photo rule for legacy categories: no.
- Q2 OTHERS -> Furniture > Accessory: yes.
- Q3 hide Combo Pricing / Variants / Maintenance too: ask owner.
- Q4 copy model photos to SKUs: no.
- Q5 sub-categories edited by code + migration for now.
- Q6 accounts for the six groups: owner binds under Accounting > Item Groups.
- Q7 subcontractors marked by supplier category for now.

## Conflict rules with phases 2 and 3
Phase 1 lands the shared contract and migrations first; phases 2 and 3 only import from `renovation-catalog.ts`, `product-categories.ts`, `MfgProductRow`. Phase 1 does not touch `sales-order-pdf.ts`, `mfg-sales-orders.ts`, `scm/index.ts`, `backend/src/index.ts`, `App.tsx`, `routeManifest.ts`. Phase 3 reuses `PhotoGallery.tsx` and the public-proxy pattern.
