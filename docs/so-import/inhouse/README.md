# In-house renovation SO import (The Conts brand, 2 Nov 2026)

The owner's in-house renovation orders become engine contracts under the brand The Conts (inhouse renovation:
302- customer, 481- advance account), each under its own renovation project. Same path as the Dream Crafter import
(`docs/so-import/README.md`): quotation, accepted, converted to a TC-SO, through the screens' own code.

- Sources (not kept in the repo): `FOR IT USE QUOTATIION EMBASSY.xlsx` (one sheet per Skyline Embassy unit),
  `Copy of Owner Data.xlsx` (tabs KL 48, EMBASSY, Other: unit, layout, owner), `KL 48 AMENITIES-TYPE A (1).pdf` and
  `KL 48 AMENITIES-TYPE B.pdf` (the package lines, no line prices).
- `build_data.py` builds `inhouse-so-data.json` from them. Only unit, layout and owner name are read from the Owner Data;
  contact details and the other columns stay out.
- `engine/backend/scripts/so-inhouse-import.mts` imports it, in ONE transaction; `--dry-run` builds everything and
  rolls back. Run on production by the one-off workflow `.github/workflows/so-inhouse-import.yml`.

Decisions (owner and coordinator, 2 Nov 2026):

- Embassy: one SO per quotation sheet, with that sheet's own lines and prices. The sheet's TOTAL (RM) is the contract;
  what the lines add up to above it is the document discount ("Discount as per quotation"), the Dream Crafter rule.
- The sheets labelled C-35-03 and C-39-08 carry swapped labels: the building stacks make every -03 unit Type C dual key
  and every -08 unit Type A, as the Owner Data says. C-35-03 is built from the sheet labelled C-39-08 and C-39-08 from
  the one labelled C-35-03; each SO's note says so.
- SO date 31 Oct 2026 for every order: neither file holds a date (the Embassy Date cells are "-"), and the orders were
  opened before the books started in the engine (1 Nov 2026).
- Accounts: each contract takes the 302- customer and 481- advance account AutoCount already keeps for its unit (chart
  import, 24 Oct 2026). No new account is opened; a unit without exactly one of each is not imported and is listed.
  C-18-06 (HOLIDAY DREAMS JOURNEY SDN BHD) and KL 48 B-41-13 (LUX UNITY SDN BHD) are matched by the owner's name, as
  their AutoCount customers carry no unit; B-43A-08 has two customers on the unit and takes the one named as the owner.
- Projects: one renovation project (type Airbnb package, brand The Conts, inhouse renovation) per Owner Data unit:
  Embassy, KL 48 and the Other tab's units with a real unit number. Address, postcode, built-up area and phone are not
  in the files.
- SKUs: the Dream Crafter rules (`docs/so-import/build/so_rules.py`), with the quotation's section deciding painting,
  feature wall and built-in lines. Dining table, working table and installation have no catalog product and take
  RN-PROJECT_MGMT with their own wording, as 20 Dream Crafter lines did.
- KL 48: Type A / Type B picks the PDF lines. The Owner Data holds no per-unit selling price (its "Business Model"
  column is the rental arrangement, to be ignored), so the KL 48 orders carry the PDF package total as a PLACEHOLDER:
  the importer dry-runs them and refuses to write them until the price source is given.

## Result on production (2 Nov 2026)

Dry run (all groups, run 41467173554): 66 projects, 59 orders, RM 1,140,370.00 at KL 48 placeholder prices, no account
opened, all rolled back. Write (EMBASSY, OTHER; run 41473106495), one transaction:

- 22 projects: RN-2610-008 to RN-2610-025 (the 18 Embassy units) and RN-2610-026 to RN-2610-029 (Other tab: SKYLINE
  KUCHAI B-53-09, M ASTRA A-12-02, A-23-19, A-26-05).
- 18 SOs, TC-SO-2610-007 to TC-SO-2610-024, dated 31 Oct 2026, RM 579,770.00, 723 lines; each on its unit's AutoCount
  302- customer and 481- advance account. Customers 302- (83) and advance accounts 481- (107) unchanged in number.

Not written: KL 48 (44 units: 19 Type A, 25 Type B) until the per-unit price is given; B-17-09, B-25-08 and B-35-13A
have no AutoCount accounts. The Other tab's two rows whose unit number is a date (Puchong Savile D'Lake, M Astra) have
no project.
