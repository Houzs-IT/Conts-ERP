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

## Import script

`scripts/catalog-first-import.mjs`. It writes to the engine's tables in schemas `scm` / `public` of the Conts Supabase
project (the engine shares it with Property OS; `engine/backend/wrangler.production.toml` reaches it through Hyperdrive).
It refuses any database except Conts production (`cweomoenhsjvsxfsmiiw`), staging (`ecgyrmblqfxvbfjlqkdq`) and
localhost. It needs the admin connection string (the `postgres` user), like `scripts/migrate-pg.mjs`.

```
node scripts/catalog-first-import.mjs --prompt --dry-run     # reads only; prints every SKU, link and cost it would write
node scripts/catalog-first-import.mjs --prompt               # writes, in one transaction, after the project ref is typed back
```

What one run does, for the company whose internal code is `HOUZS` (the Conts company, migration 0046):

1. Adds units BOX, BAG, ROLL to `scm.product_uoms` and sub-category Lighting > Track light to `scm.product_sub_categories`.
2. Creates the 7 suppliers in `scm.suppliers` (matched first by code, then by name; an existing one is used as it is).
3. Creates each SKU in `scm.mfg_products` with its own model in `scm.product_models` (as the API does), category,
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

On a fresh Postgres 17 built by `scripts/ci-api-db.mjs` (every migration): dry run listed 3 units, 1 sub-category,
7 suppliers, 819 SKUs (423 with cost, 396 price needed), 819 links, 423 cost rows; the real run created exactly that
(`runs/2026-10-20T13-24-54-962Z-local.json`); a second run created nothing (`runs/2026-10-20T13-24-55-417Z-local.json`).
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
