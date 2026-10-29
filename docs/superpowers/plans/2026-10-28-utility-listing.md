# Utility Listing (piece 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finance > Utility bills becomes a listing of every unit's electricity, water, internet and Indah Water bills month by month, newest month on the left, coloured by whether the owner has been charged, with a one-unit view, per-unit averages and an "Unusual" tab.

**Architecture:** One read-only endpoint returns, for a range of months, the units, their utility bills (with each bill's deduction state) and the nights booked per unit and month. Pure functions in `src/lib/utilityGrid.ts` turn that into cells, averages and unusual rows; the page only draws them. No migration and no change to any saved data.

**Tech Stack:** Property OS (repo root): React + Vite in `src/`, Cloudflare Pages Functions in `functions/`, Postgres schema `pos`; tests with `node --test src/lib/*.test.mjs` and an endpoint check in `scripts/api-checks/`.

**Spec:** `docs/superpowers/specs/2026-10-27-utility-bills-design.md` §7 "Utility listing" (approved mockup, 2026-10-27), plus chew's order change of 2026-10-27 (listing before OCR). Piece 1 (deduction month) is live; piece 2 (backfill, 2026-10-27) filled January–October 2026.

## Global Constraints

- All product text in English, British spelling, sentence case.
- Money in sen; bill month = month of `expenses.incurred_on`; deduction month = `expenses.deduct_month`.
- Utility kinds and their column labels, in this order: `electricity` Electricity, `water` Water, `internet` Internet, `sewerage` IWK.
- Colour of a bill (one meaning each, with a legend on the page; colours from the Property OS theme tokens, readable in dark mode, and never colour alone — each state also has a text label in the tooltip and the one-unit view):
  - **Charged to owner** (green): `charge_to = 'owner'`, not record only, and its deduction month's statement is final (`LOCKED_SQL` meaning: `finalised`, `sent` or `paid`).
  - **Not charged yet** (amber): `charge_to = 'owner'`, not record only, deduction month not final.
  - **Company pays** (no colour): `charge_to <> 'owner'`.
  - **Record only** (blue): `record_only`.
  - **No bill**: "–".
  - A cell holding several bills takes the first of: Not charged yet, Charged to owner, Record only, Company pays.
- Nights booked = nights of stays in state `confirmed`, `checked_in` or `checked_out`, channel not `maintenance_block` or `owner_stay`, falling in the month (`nightsInWindow`, `functions/_lib/revenue.ts:21`) — the same stays the owner statement counts (`functions/_lib/ownerStatement.ts:430-434`).
- Unit average per month = the unit's utility total in the range ÷ months in the range that have at least one bill. Average per night = utility total of the months with nights ÷ nights in those months; months with no nights are left out; "–" when there are none.
- Unusual = a unit's bill of one kind whose month total is more than 50 % above or below the average of the same kind in the previous three months; judged only when at least two of those three months have a bill.
- The endpoint: `requireSession`, `session.manage` (as `functions/api/expenses/utilities.ts`), read only, so no `audit`.
- No change to the statement engine, saved bills or the existing "Utility bills" entry modal.
- Finance > Utility bills opens the listing; the entry modal moves behind the page's "Enter this month's bills" button (chew, 2026-10-28).

## Review Focus

1. A unit with a bill rolled forward (bill month September, deduction month October) shows the bill under **September** (its bill month), coloured by the **October** statement's state. (Task 1 test.)
2. A month whose only bill is record only must not count as "Not charged yet", and a company-paid bill must not appear in the owner-charged colours. (Task 1 test.)
3. A unit with no nights in a month: average per night leaves that month out and never divides by zero. (Task 1 test.)
4. Shared-meter pairs and units with no utility account still list (empty "–" cells), so missing bills are visible. (Task 2 check.)
5. 120 units × 12 months loads in one request and renders without a horizontal page scroll on a phone (the grid scrolls inside its own box, unit column sticky). (Task 3 check.)

---

### Task 1: Grid rules (pure functions)

**Files:**
- Create: `src/lib/utilityGrid.ts`
- Test: `src/lib/utilityGrid.test.mjs`

**Interfaces:**
- Produces:
  - `type UtilityKind = 'electricity' | 'water' | 'internet' | 'sewerage'`; `KINDS: UtilityKind[]` in column order; `KIND_LABEL: Record<UtilityKind, string>`.
  - `type BillState = 'charged' | 'pending' | 'company' | 'record'`.
  - `interface GridBill { id: string; unitId: string; kind: UtilityKind; billMonth: string; deductMonth: string; amount: number; chargeTo: string; recordOnly: boolean; final: boolean; receiptId: string | null; reference: string | null; rolled: boolean }`
  - `billState(b: GridBill): BillState`
  - `interface Cell { amount: number; state: BillState | null; bills: GridBill[] }` (state null = no bill)
  - `buildCells(bills: GridBill[]): Map<string, Cell>` keyed `${unitId}|${kind}|${month}`, plus `${unitId}|total|${month}` (total cell has state null).
  - `months(from: string, to: string): string[]` newest first.
  - `unitAverages(cells, unitId, monthList, nights: Record<string, number>): { perMonth: number | null; perNight: number | null }`
  - `unusual(cells, unitIds, monthList, nightsByUnit): { unitId: string; kind: UtilityKind; month: string; amount: number; baseline: number; changePct: number; nights: number; baselineNights: number }[]` sorted by absolute change, largest first.

- [ ] **Step 1: Write the failing tests** — `billState` for the four states (including rolled: bill month 2026-09, deduct month 2026-10, `final` false → pending); a two-bill cell of states charged + pending → pending; record only + company → record; `months('2026-01','2026-10')` → 10 months starting `2026-10`; averages: bills in 3 of 4 months → total ÷ 3; per night skips a month with 0 nights and returns null when all are 0; unusual: previous 100/100/100 sen, this month 151 → listed (+51 %), 149 → not listed, 49 → listed (−51 %); only one previous month with a bill → not judged.
- [ ] **Step 2: Run** `node --test src/lib/utilityGrid.test.mjs` — expect failure (module missing).
- [ ] **Step 3: Implement** in `src/lib/utilityGrid.ts` (amounts in sen, integer maths; percentages rounded to 1 decimal).
- [ ] **Step 4: Run the test again** — expect pass.
- [ ] **Step 5: Commit** `feat(utilities): grid rules for the utility listing`.

### Task 2: Listing endpoint

**Files:**
- Create: `functions/api/expenses/utilities/listing.ts` (GET), or add a `listing` branch to the existing `functions/api/expenses/utilities.ts` if the router layout requires it.
- Test: `scripts/api-checks/utility-listing.mjs`; add it to `.github/workflows/ci.yml` beside `late-bills.mjs`.

**Interfaces:**
- Consumes: `LOCKED_SQL` (`functions/_lib/expenses.ts:27`), `nightsInWindow`.
- Produces: `GET /api/expenses/utilities/listing?from=YYYY-MM&to=YYYY-MM[&building=<propertyId>][&unit=<unitId>]` → `{ months: string[]; units: { id, property, propertyId, number, owner: string | null }[]; bills: GridBill[]; nights: Record<unitId, Record<month, number>> }`. Units = every active unit (with or without bills), ordered by building then unit number. Range capped at 24 months; default when absent: the last 12 months ending this month. Bills = utility kinds with `incurred_on` in the range; `final` computed with `LOCKED_SQL` on the bill's `deduct_month`.

- [ ] **Step 1: Write the check** (`cookieFor()` session as in `late-bills.mjs`): seed one unit with an electricity bill charged on a final statement, a water bill not yet final, an internet bill company-paid, an IWK record-only bill, a rolled bill, and one stay of 3 nights; a second unit with no bills. Assert: 403 without `session.manage`; both units listed; each bill's `final`/`recordOnly`/`chargeTo` as seeded; the rolled bill under its bill month with `deductMonth` the next month; nights = 3 in the stay's month; a range over 24 months → 400 "Choose up to 24 months.".
- [ ] **Step 2: Run** it against the local dev server (PGlite `scripts/dev-pglite.mjs` + `wrangler pages dev`) — expect failure.
- [ ] **Step 3: Implement** — one SQL statement (units, bills, nights as json, like `ownerStatement.ts:428`); nights summed per month in SQL from the stays overlapping the range.
- [ ] **Step 4: Run the check again** — expect pass; `npm run check` passes.
- [ ] **Step 5: Commit** `feat(utilities): listing endpoint`.

### Task 3: Listing page — all bills and one unit

**Files:**
- Create: `src/pages/finance/UtilityListing.tsx`
- Modify: `src/pages/ExpensesPage.tsx:122-146` (Finance > Utility bills opens the listing instead of the entry modal), `src/App.tsx:350,358` only if the route element changes.

**Interfaces:**
- Consumes: Task 1 functions and types; Task 2 endpoint; `UtilitiesModal` and `AddUtilityBill` (already lazy-loaded in `ExpensesPage.tsx:36-37`); `downloadFile` as in `src/components/ReceiptCell.tsx:19`.

Page layout (matches the approved mockup):
- Header "Utility bills", sub "Every unit's electricity, water, internet and Indah Water bills, month by month." Buttons: **Enter this month's bills** (opens `UtilitiesModal`, as the menu does today) and **Add utility bill**.
- Tabs: **All bills** · **Unusual** (Task 4). Filters: months (last 6 / 12 / 24, default 12), building, unit search, kind (All, or one kind: then each month has one column instead of five).
- **All bills** grid: unit column sticky on the left (building, unit number, owner); months across, newest first; each month a group of Electricity, Water, Internet, IWK, Total; then **Average / month** and **Average / night** at the right end. Cell = amount in RM (2 decimals, tabular numbers, right-aligned), background by state, "–" for no bill. Legend above the grid. The grid scrolls inside its own box with a sticky header.
- Cell click: one bill → a small panel with kind, bill month, deduction month (and "late bill" when rolled), amount, who pays, state, account number, and **View bill** (receipt download) when it has a receipt; several bills → the same panel listing each.
- **One unit view**: clicking a unit name shows that unit alone — one row per kind plus Total and Nights booked, months across newest first, the same colours, and a state label under each amount.
- Export to Excel of the grid as shown (amounts and state text).
- Empty: "No utility bills in these months." Loading: skeleton of the grid. Error: the page's usual error banner with Retry.

- [ ] **Step 1: Write a render test** if the page folder has a pattern for one; otherwise extend `scripts/api-checks/utility-listing.mjs` to load the page route and assert it returns 200 (the existing smoke pattern).
- [ ] **Step 2: Implement** the page and wire the menu.
- [ ] **Step 3: Check in the browser** (local preview): colours in light and dark mode, phone width (no page scroll, grid scrolls), one-unit view, cell panel, receipt opens, Enter this month's bills still opens the modal and saving refreshes the grid.
- [ ] **Step 4: Commit** `feat(utilities): utility listing page`.

### Task 4: Unusual tab

**Files:**
- Modify: `src/pages/finance/UtilityListing.tsx`

**Interfaces:**
- Consumes: `unusual(...)` from Task 1.

Table (DataTable): Unit, Kind, Month, This month (RM), Average of previous 3 months (RM), Change (% with ▲/▼; above = danger colour, below = warning colour), Nights this month, Average nights previous 3 months. Sorted by size of change. Clicking a row opens the one-unit view at that month. Note under the title: "A bill more than 50 % above or below the same unit's average for the previous three months. Compare the nights: more guests usually means more usage."

- [ ] **Step 1: Implement** the tab.
- [ ] **Step 2: Check in the browser** with production-like data (local seed of the backfilled shape): rows appear for a seeded jump, none for steady bills.
- [ ] **Step 3: Commit** `feat(utilities): unusual bills tab`.

### Task 5: Release

- [ ] **Step 1:** `node --test src/lib/*.test.mjs`, the new api check, `npm run check`, `npm run build` — all pass.
- [ ] **Step 2:** Fresh reviewer (most capable model) on the whole branch against this plan and spec §7; fix findings.
- [ ] **Step 3:** PR, CI green, merge (`gh pr merge --merge`), watch the Property OS deploy; open Finance > Utility bills on production and check October 2026 (backfilled) shows green/amber/blue as expected for three known units.
- [ ] **Step 4:** Tell chew in Chinese what changed and where to click.
