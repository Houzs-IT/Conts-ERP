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

## Production fixes after the import (27 Oct 2026, SQL in one transaction each, dry-run first)

Ten PDFs had two-digit years ("16/8/25") and were first dated on the import day, so their SOs were numbered in
October. With their dates corrected they were renumbered to their real month (owner, 27 Oct), and October's
remaining imports closed the gap. Every table that stores the SO number was updated; the PDF file name stays in
each SO's note, which is how an SO is traced back to Notion.

| Old | SO date | New |
| --- | --- | --- |
| TC-SO-2610-007 | 2025-08-15 | TC-SO-2508-002 |
| TC-SO-2610-009 | 2025-08-16 | TC-SO-2508-003 |
| TC-SO-2610-005 | 2025-08-26 | TC-SO-2508-004 |
| TC-SO-2610-010 | 2025-09-29 | TC-SO-2509-008 |
| TC-SO-2610-011 | 2025-09-29 | TC-SO-2509-009 |
| TC-SO-2610-012 | 2025-09-29 | TC-SO-2509-010 |
| TC-SO-2610-008 | 2025-10-19 | TC-SO-2510-003 |
| TC-SO-2610-004 | 2026-03-23 | TC-SO-2603-013 |
| TC-SO-2610-006 | 2026-04-29 | TC-SO-2604-008 |
| TC-SO-2610-003 | 2026-04-30 | TC-SO-2604-009 |
| TC-SO-2610-013 | 2026-10-07 | TC-SO-2610-003 |
| TC-SO-2610-014 | 2026-10-09 | TC-SO-2610-004 |
| TC-SO-2610-015 | 2026-10-16 | TC-SO-2610-005 |
| TC-SO-2610-016 | 2026-10-20 | TC-SO-2610-006 (MS IRIS, no project) |

Their quotations keep the numbers minted on the import day (e.g. QT-2610-009 for TC-SO-2508-002).

TC-SO-2606-001 (D'VINE 31-31): four "PAGE OF [PAGES]" lines (RM 10, page footers read as items) were removed
from the SO and its quotation, and the document discount went from RM 10.20 to RM 0.20; the total is unchanged
at RM 23,012.00.
## Re-import (owner, 29-30 Oct 2026)

This replaces the numbering above: the orders were deleted and imported again, so their numbers were minted afresh.

The owner found three things on the SO screen; nothing had used the imported orders yet, so the first import was
deleted (`delete-first-import.sql`, checked: no payment, DO, invoice, bill, PO line or receipt pointed at them) and
the import ran again:

- Item showed the PDF wording, so the SKU picker found nothing. Item now shows the line's catalog product (the SKU
  it was always bound to) and the PDF wording and sizes are in Remarks. The contract and its print keep the PDF
  wording.
- A heading printed with an amount ("WIRING WORKS (ESTIMATE) 7000") was read as an item, so the lines under it
  landed in the previous section. Such a heading is now a lump-sum section when nothing under it has its own amount
  (the printed figures under it are rates, kept in the text); otherwise it stays a priced line. "- BEDROOM 2" lines
  under an item now carry the item's name ("ROLLER BLINDS / ZEBRA BLINDS - BEDROOM 2"). A page whose printed total
  equals the sum of all its lines no longer loses its last line as a "subtotal" (USJ TYGER lost RM 7,500 of painting
  that way; BANGSAR HILLPARK its RM 2,000 project management fee). Versions needing a "Package price" line: 22 -> 17.
- Address and property: `project-addresses.sql` fills blank project fields only: address from building and unit,
  the area, city and state where they are certain, property type (Condo / Landed) from the unit number. Layout,
  built-up area and the remaining postcodes are not on the PDFs: staff fill them (sheet sent to the owner).

Rooms stay the contract's sections, as every quotation converts: these SOs are laid out by trade, and only 931 of
3,752 lines name a room. SO numbers are minted again in SO-date order, so each month starts at 001 (October after
the two test orders). MS IRIS is linked to project 100, made by the team on 29 Oct.
