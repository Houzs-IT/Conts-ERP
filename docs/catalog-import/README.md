# Renovation catalog: first import (20 Oct 2026)

The owner's supplier documents (folder `IT`, 18 PDFs: UNILOC, DHI, LB stone, HOOKKA, Lot Win, World One, K & K)
turned into one list of SKUs, for review and then for a one-off import into the engine.

| File | What it is |
| --- | --- |
| `catalog-review.xlsx` | For the owner: Read me, Summary, Categories, SKUs (902 rows, file + page for each), Suppliers, Questions |
| `catalog-data.json` | The 819 rows marked Import = Y, with suppliers, new units and the new sub-category. Read by the script |
| `catalog-import.csv` | The 778 rows the SKU Master > Import SKUs button can take as it is (headings `code,name,category,sub_category,uom,status,description,branding`). The button cannot set suppliers or cost; prefer the script |
| `catalog-import-excluded.csv` | Rows not in that CSV, and why |
| `build/` | The extraction scripts and their intermediate files (rerun: see below) |
| `runs/` | One note per real run of the script (target, counts, what was skipped) |
| `catalog-fix-review.xlsx` | The fix of 21 Oct 2026 (migration 0132): Unit changes, Owner to decide, Bedframe sizes, Sofa compartments, Models, Deleted, Units |
| `catalog-fix-data.json` | The same fix as data (unit changes, models, new SKUs, deleted codes); `build/fix.py` writes it, the xlsx and the migration |
| `SKU-listing-after-fix.xlsx` | Every SKU after the fix, read from a local database built the way production was (`build/listing.mjs` + `build/listing.py`) |
| `screens/` | The engine's Products page with the size / compartment SKUs, at 1440 and 375 wide |

## Import script

`scripts/catalog-first-import.mjs`. It writes to the engine's tables in schemas `scm` / `public` of the Conts Supabase
project (the engine shares it with Property OS; `engine/backend/wrangler.production.toml` reaches it through Hyperdrive).
It refuses any database except Conts production (`cweomoenhsjvsxfsmiiw`), staging (`ecgyrmblqfxvbfjlqkdq`) and
localhost. It needs the admin connection string (the `postgres` user), like `scripts/migrate-pg.mjs`.

```
node scripts/catalog-first-import.mjs --prompt --dry-run     # reads only; prints every SKU, link and cost it would write
node scripts/catalog-first-import.mjs --prompt               # writes, after the project ref is typed back
node scripts/catalog-first-import.mjs --emit-sql=docs/catalog-import/sql/catalog-first-import.sql   # no database needed
```

Without a connection string: apply `sql/catalog-first-import.part-01-of-02.sql` then `part-02-of-02.sql` (Supabase SQL
editor or connector). Each part is one transaction (begin/commit), under 400 KB, repeats the small setup (units,
sub-category, suppliers) and carries its own SKUs, so each is safe to run alone, in order, and again. The last
statement of each part returns the counts for the whole catalog: after both parts, 819 SKUs, 819 supplier links,
423 priced links, 423 cost rows. The script's real run executes exactly these parts
(`scripts/catalog-first-import-sql.mjs`), so the two ways cannot give different rows. Each part also leaves an import
note in `scm.app_config` (key `note:catalog-first-import-2026-10:part-N`).

What one run does, for the company whose internal code is `HOUZS` (the Conts company, migration 0046):

1. Adds units BOX, BAG, ROLL to `scm.product_uoms` and sub-category Lighting > Track light to `scm.product_sub_categories`.
2. Creates the 7 suppliers in `scm.suppliers` (matched first by code, then by name; an existing one is used as it is).
3. Creates each SKU in `scm.mfg_products` (id `mfg-` + 12 hex of sha256 of the SKU code, the same everywhere) with its own model in `scm.product_models` (as the API does), category,
   sub-category, unit, description (the spec), branding (supplier name) and `cost_price_sen`. Works SKUs are Active;
   Built-in / Furniture / Lighting / Soft SKUs are Inactive until a photo is added (migration 0062 enforces it).
   No selling price is set: no document gives one.
4. Links each SKU to its supplier in `scm.supplier_material_bindings` (`material_kind = 'mfg_product'`, main supplier,
   supplier's own code in `supplier_sku`, `unit_price_sen` = cost, `price_valid_from` = document date, the source
   document in `notes`). The SKU Master's "Main Supplier" and "Main Cost" columns read this link.
5. Writes one `scm.supplier_binding_price_history` row per priced link (effective = document date).

Rows with no price (DHI, LB, HOOKKA catalogues) get the SKU and the supplier link with cost 0 and a note
"PRICE NEEDED"; the SKU Master shows them as RM 0.00. `is_cost_anchor` is left off on purpose: an anchored link copies
its price into the SKU's `base_price_sen` (the selling price) on the next edit, and cost is not a selling price.

Re-running is safe: codes that exist are skipped and listed, links are added only where that supplier has none for the
SKU, cost rows only where none exists for that supplier, SKU and date.

### Verified locally (20 Oct 2026)

On fresh Postgres 17 databases built by `scripts/ci-api-db.mjs` (every migration): dry run listed 3 units, 1 sub-category,
7 suppliers, 819 SKUs (423 with cost, 396 price needed), 819 links, 423 cost rows; the script's run created exactly that
(`runs/2026-10-20T13-41-26-372Z-local.json`) and a second run created nothing. The emitted SQL applied with psql on a
second fresh database gave row-for-row the same units, sub-category, suppliers, SKUs, models, links, cost rows and notes
(3,001 rows compared, ids and timestamps aside); applying both parts again changed nothing; on a third database part 2
alone, then part 1, gave the same rows again.
With the engine (`wrangler dev`) and its screens (`vite`) on that database through a local PostgREST: SKU Master shows
844 SKUs (819 + 25 seeded generic ones) with Main Supplier and Main Cost (e.g. DOR-KNK-001 K & K RM 93.00); Suppliers
shows the 7 suppliers; World One's SKU Pricing tab lists its 4 fans at RM 130.00, main. Five CSV rows (one per group)
went through `POST /api/scm/mfg-products/batch-import` without a failure.

## Read-only checks for production before applying

The dry run already lists every code that exists and every new SKU whose name matches an existing one. To look first:

```sql
-- company, existing tree and units
select id, code, name from public.companies where code = 'HOUZS';
select group_code, code, label, active from scm.product_sub_categories order by group_code, code;
select code, label, active from scm.product_uoms order by sort_order;
-- suppliers that may already be there under another code
select code, name from scm.suppliers
 where company_id = (select id from public.companies where code = 'HOUZS')
   and (name ilike any (array['%crafted%','%uniloc%','%dhi%','%little builder%','%hookka%','%lot win%','%world one%','%k & k%','%k&k%','%gypsum%']));
-- SKUs per group today, and any that look like these
select category::text, sub_category, count(*) from scm.mfg_products
 where company_id = (select id from public.companies where code = 'HOUZS') group by 1, 2 order by 1, 2;
select code, name, category::text, sub_category from scm.mfg_products
 where company_id = (select id from public.companies where code = 'HOUZS')
   and (code ~ '^(FLR|FWL|CPT|PTN|PLC|DOR|GLS|PNT|MSN|CTP|SOF|BED|ACC|LED|DLT|TRK|FAN)-'
        or name ~* '(uniloc|dhi|spc|quartz|sintered|hookka|gypsum|fluted|ceiling fan|downlight)');
```

Put what matches into the "Exists in system?" column of the SKUs sheet if the owner wants to see it there.

## Rebuilding the files

The PDFs are not in the repo (110 MB, owner's documents). With them extracted somewhere (`IT/...`):
`build/dump.py`, `build/lb.py` (LB card positions), `build/kklines.py` + `build/kkparse.py` (K & K list) produce the
intermediate files already in `build/`; `build/build.py <dir with lb.json, kk_auto.json, kk_lines.txt> rows.json` makes
the rows and `build/excel.py rows.json <out dir>` writes the xlsx, both CSVs and `catalog-data.json`. Run Python with
`-I`. The Lot Win scans and the image-only DHI pages were read by eye; their rows are typed into `build.py`.
LB quartz page 9 carries a hidden text layer (KPQ007-012 at 3200 x 1600) under the visible cards; it is not used.

## Catalog fix, 21 Oct 2026 (migration 0132)

Owner feedback on the first import, applied by `migrations-pg/0132_catalog_fix_sizes_compartments_units.sql` (built by
`build/fix.py`; edit the script, not the migration):

- HOOKKA bedframes and sofas follow the engine's own model / variant shape (`product-models.ts` generate-skus): each model
  becomes a BEDFRAME or SOFA model with `allowed_options.sizes` / `.compartments`, and one SKU per size
  (`BED-HKA-1003-(K)`, size code K / Q / SS / S / SK, SP for a cm size) or per compartment (`SOF-HKA-5530-1A(LHF)`),
  with `base_model`, `size_code`, `size_label`, linked to HOOKKA as main supplier (cost 0, price needed). The engine's
  code pattern is kept so its Generate SKUs button finds them instead of making duplicates. HOOKA.pdf cuts most lists
  short, so only the printed sizes / compartments exist (95 bedframe, 65 sofa SKUs); the rest waits for HOOKKA's list.
- The 13 "2990 list" sofas and the 39 single SKUs replaced above are deleted with their supplier links and models when
  no document, stock or price row names them (else deactivated); each is written to `scm.entity_audit_log`.
- Units: each SKU takes the unit its supplier writes ("RM/Unit" -> UNIT, "RM/FT²" -> SQFT, K & K "no" -> NOS, ...);
  where a document writes none the SKU keeps its unit and is listed for the owner. Labels made clearer (FT = "Foot run").
- The migration does nothing where the first import never ran, so on a fresh local database run the import script and
  then this migration's body if you need the fixed catalog (or build it the way `SKU-listing-after-fix.xlsx` was).

Verified locally (21 Oct 2026, Postgres 17): migrations to 0131, the import (819 SKUs), 0130's activation as production
had it, then 0132: 844 -> 952 SKUs, 819 -> 927 supplier links, cost rows unchanged (423), no link or cost row left without
its SKU, 52 audit rows; running 0132's body again changed nothing; with a price-history row planted on two SKUs those two
were deactivated, not deleted. Engine Products page (wrangler dev + vite + local PostgREST) lists the new SKUs: `screens/`.

## HOOKKA quotation 300-T, AKEMI mattresses, customer items, 22 Oct 2026 (migration 0142)

HOOKKA's quotation to The Conts (customer 300-T, effective 22 Oct 2026) replaces the HOOKKA catalogue; the AKEMI rows of
Houzs Century's mattress list are added; one "Customer <sub-category>" SKU per active sub-category (and one per group) is
added on supplier CUSTOMER at cost 0. Built by `build/hookka_parse.py` (PDF -> `build/hookka_300t.json`) and
`build/hookka.py` (-> `hookka-300t-data.json`, `hookka-300t-review.xlsx`, the migration); edit the scripts, not the migration.

| File | What it is |
| --- | --- |
| `hookka-300t-review.xlsx` | Read me, Bedframes, Sofas (matrix), Accessories, Mattresses, Surcharges, Changes vs current system, Customer items, Questions |
| `hookka-300t-data.json` | Every SKU / model / supplier price book the migration writes |
| `SKU-listing-after-hookka.xlsx` | Every SKU after 0142, read from a local database built the way production is (`build/listing.mjs` + `build/listing.py`) |
| `build/akemi_mattress.csv`, `build/subcategories-2026-10-22.json` | Inputs: the 231 AKEMI rows; the sub-categories the Customer items sheet lists |

Cost follows the engine's own shape (`engine/backend/src/scm/lib/cost-anchor-sync.ts`): `base_price_sen` = Price 2 cost,
`price1_sen` = Price 1 cost, sofa `seat_height_prices[].priceSen` per seat height and tier; the main supplier link carries
the same as `price_matrix` plus a flat `unit_price_sen` and is the cost anchor. A renovation contract line has no seat
height, so it takes the flat cost (sofa: P2 at the smallest quoted seat height); the renovation product lookup no longer
offers a bedframe / sofa / mattress cost as a selling price. HOOKKA's surcharges are HOOKKA's supplier price book
(maintenance scope `supplier:<HOOKKA id>`); the master maintenance is unchanged. A renovation contract raises no PO for a
Customer item (`renovation-po-split.ts` isCustomerSupplied).
