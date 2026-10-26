# Notion SO import (26 Oct 2026)

The owner's renovation sales orders lived as PDFs in Notion (Notion SO.zip, 107 PDFs, 79 projects). They become
engine contracts with our own numbers (TC-SO-YYMM-NNN, dated as the PDF).

- `so-notion-data.json`: one entry per project, its PDFs oldest first, each with its sections, lines (SKU, qty,
  price, discount) and the final total printed on it. Built by `build/` from the PDFs (not kept in the repo).
- `engine/backend/scripts/so-notion-import.mts`: the import. Per project, in one transaction, through the same code
  the screens use: oldest PDF -> quotation -> accepted -> sales order; every later PDF -> a variation order that omits
  the lines that disappeared, adds the new ones, and adds a "Price adjustment" line for any rest, so the revised
  contract always equals the PDF's printed final total. The script stops on any mismatch.
- Run on production by the one-off workflow `.github/workflows/so-notion-import.yml` (dry-run, then apply).

Decisions (owner, 26 Oct 2026): our own SO numbers; later PDF versions are VOs; prices need not be split where a PDF
prices several lines together; customer contact details are not on the PDFs and stay blank; payments come later
from Accounts.

How the totals were reconciled:
- Lines add up to more than the printed final total: the difference is the SO's document discount
  ("Discount as per signed SO"). Most are the showroom / special discounts printed on the PDF.
- Package PDFs (lines without prices): one "Package price" line carries the rest.
- 77 of 107 PDFs' lines match their own page totals exactly; the rest are package pages, summary pages or rows the
  PDF prints out of line. Their totals are still exact through the two rules above.

SKU matching: `build/so_rules.py` (the rules made for the AutoCount outstanding SOs, 25 Oct) plus `build/so_sku.py`
fallbacks. About 98% of priced lines match a SKU directly; 20 lines fall back to RN-PROJECT_MGMT with their own
description.

Not imported to a project: THE HIPSTER C10-05 MS IRIS (no project in the system); its SO has no project link.
ASTER HILL B-01-06 MR AIDEN is the project ASTER HILL A-01-06 (the PDF says A-01-06).

Rebuild (paths in the scripts point at the scratch folder used on 26 Oct): `so_parse.py` -> `so_check2.py` ->
`so_sku.py` -> `so_build.py`. Local test: `node scripts/dev-pglite.mjs`, then `build/local-setup.mjs <url>`, then
`npx tsx scripts/so-notion-import.mts` in engine/backend.
