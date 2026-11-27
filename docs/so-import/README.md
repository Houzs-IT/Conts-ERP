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

## Notion update (owner, 18 Nov 2026)

"Notion is the truth": the sales team updated every SO PDF in Notion, and each renovation SO must match its latest
PDF line by line (SKU, qty, line price, total). The Notion database was exported again (81 projects, 88 PDFs) and
rebuilt into `so-notion-data-2026-11-18.json` with the parser fixed for what the new PDFs exposed:

- a page printed without the column header row lost all its lines (JERNIH KAJANG B-28-09: 24 wiring lines);
  such a page now uses the previous page's columns, and a header without its "Qty" word takes the previous one;
- a final total printed as "FINAL 31,293.30" (no "TOTAL") was missed, so 7 SOs held the total before the printed
  discount; a page total printed beside a note ("( FOLLOW 3D) TOTAL (RM) 3410") was missed (KAIA HEIGHT);
- the sum row of a DISC PRICE sheet was taken as the final total ahead of the printed FINAL TOTAL (SKYLINE D-41-12);
- a part listed under an item that carries the amount, or a price with an empty amount on a page whose printed
  total is its amounts, is a rate kept in the text, not money (THE FORESTA wiring, D'TERRA 2EP);
- a DISC PRICE sheet whose totals add the Amount column is charged at the amounts (NESTREE, SKYLINE D-41-12);
- an item whose size says "TOTAL : W:68FT" is no longer a summary row (EMERALD 9); a table printed
  Amount | Unit price | Qty is read in that order (SKYLINE PUDU C11-09 / C13A-05 Airbnb set); "PAGE n OF" footers
  are not items; a page's last line is no longer dropped as a subtotal when only two lines have amounts.

Every page's printed total was then checked against the lines read from it; what is left is package pages, summary
pages and lump-sum headings, whose totals are exact through the rules above.

`engine/backend/scripts/so-notion-update.mts` (run by the one-off workflow `.github/workflows/so-notion-update.yml`,
dry-run then apply) brings each SO to its latest PDF with one variation order: lines kept when the wording, qty and
amount match (or the SKU, qty and amount, so wording fixes alone do not churn lines already on a PO), the rest
omitted / added, and a "Price adjustment" line for any rest so the revised contract equals the printed final total.
The two projects with no SO yet (AVA KIARA BAY D21-11 MR YAU, SAFFIRE NEW OFFICE) get their SO created the way the
first import did. Rooms already set on an SO are kept; only new lines take a room from their wording.

Applied on production 18 Nov 2026 (dry-run three times first): 26 SOs changed by one VO each, 2 SOs created
(TC-SO-2512-003 AVA KIARA BAY D21-11 MR YAU, TC-SO-2610-068 SAFFIRE NEW OFFICE), 53 already matching, 0 failed.
Checked afterwards: a fresh dry-run reports all 81 matching; every SO's total equals its PDF's final total; qty, unit
price and amount of every priced line equal the PDF's (78 SOs exactly; 3 carry one extra line, the lump-sum heading
their PDF prices as a section). The one-off workflow was then removed.

## Jin Ni quotations (owner, 27 Nov 2026)
"All data, amounts included, follow our Google sheet": Jin Ni's unit quotations (Google sheet "JINNI UNIT PROGRESS",
column Quotation, 18 PDFs on Drive) are the truth for her SOs. The CODE/COLOUR on a quotation is our Hin Lim code
(355019 = FUR-HLM-355019); five codes Hin Lim lists as OBSOLETE were missing and are opened by migration 0398.
`jinni-quotes-2026-11-27.json` holds the target per project, applied by `engine/backend/scripts/so-jinni-update.mts`
(the 18 Nov script with this data) through the one-off workflow `.github/workflows/so-jinni-update.yml`.
- SKYLINE EMBASSY, 9 SOs: each live SO with the quotation's SKUs, quantities, added and dropped lines; one VO each.
  Lines keep their own prices; a qty change keeps the unit price; an added light is RM 0 (as on the other SOs), the
  added bedside table 131198 takes the price of the 131098 one it splits from. Total: the quotation's printed total
  where it prints one (A-11-05, C-31-01, C-51-06: RM 35,990), else the SO's own total, unchanged.
- ASTRUM, 5 new SOs (R-13-03, R-16-22, R-21-18, R-54-16, S-25-20): lines without prices plus one package line,
  RM 21,499 each (RM 14,999 + Airbnb RM 5,000 + electrical RM 1,500). The optional "extend kitchen top RM 100" is left out.
- ASTRUM A-24-31 (no project before): project opened (customer SUN WENG FONG, from the quotation) and its SO at the printed
  RM 23,500. ASTRUM S-24-29 (on the sheet, no project, no quotation): project only, customer SUWARNARAJ CHINNIAH (the
  rental side's owner of that unit).
- Not done, waiting on the owner: ASTRUM R-29-27, R-52-29, A-17-20 print no total; ASTRUM R-19-23 has no project and no
  owner on record.
