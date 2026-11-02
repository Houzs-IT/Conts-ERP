# Payment Voucher: Purpose, Unit and Project Pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a payment voucher, finance first says who the money is for: Rental, Renovation or Company.
- Rental lines can name a unit.
- Renovation needs a project, picked from a searchable table.
- The unit reaches the ledger, and a Finance report shows Rental costs by unit.
- The department "Supply chain" is shown as "Renovation" everywhere it means the department.

**Architecture:**
- **Pickers.** Two reusable searchable-table pickers, `ProjectPicker` and `UnitPicker`, replace the native selects. Both are used on the voucher (new and edit), and `ProjectPicker` also on the AP invoice line.
- **Purpose.** A purpose switch on the voucher header sets every line's department.
- **Unit in the ledger.** `unit_id`, already on `payment_voucher_lines`, is written by the form, kept on edit, and carried into `journal_entry_lines.unit_id` by `pvLines`.
- **Report.** A read-only report sums the Rental expense lines per unit and account.
- **Rename.** Display only: the stored department value stays `supply`.

**Tech Stack:** Hono engine (`engine/backend`), PostgREST `sb`, vitest with `fakeSb`, React + TanStack Query (`engine/frontend`), migration in root `migrations-pg/`.

**Spec:** chew's answers in chat, 2026-11-02. Each is recorded in `docs/finance/FINANCE-SOP.md` 3.2 by Task 1.

## Global Constraints

**Purpose**
- The header asks "For" with three choices: **Rental**, **Renovation**, **Company**.
  - Rental → department `rental`. Each line may name a unit, but does not have to: with no unit it is Rental's general cost.
  - Renovation → department `supply`. The voucher's project is required.
  - Company → department `shared`. No unit and no project.
- A voucher whose lines already have mixed departments (an older one, or one made from a payment request) opens with **Mixed**: the line departments stay editable as today.

**The unit stays on the finance side (chew, answer A)**
- The unit is recorded on the ledger and shown in a Finance report.
- It is never charged to the owner. Owner statements and the Property OS unit P&L are untouched.

**Department rename**
- The `supply` department is shown as **"Renovation"** in every department picker, report, filter and message.
- The internal-project option "Supply chain (showroom)" becomes "Renovation (showroom)".
- "Supply Chain" as the system/menu/page-eyebrow name is **not** changed, and neither is the brand switch (The Conts / Dream Crafter).

**Project picker (searchable table)**
- Columns: Project (name without a leading "SO - "), Customer, Code, Status, Handover.
- Search matches name, customer and code, without regard to case.
- Projects not yet done come first, newest first. Handed-over or closed projects follow under a "Completed" heading and can still be picked. Test projects (name starts with "TESTING" or "DEMO") go last, marked "Test".

**Unit picker:** columns Building and Unit, searchable on both. It reads `public.conts_units`, the existing view.

**Wording and migrations**
- Screen text in British English.
- Next free migration number; never DROP; grants as usual.

## Review Focus

1. **Editing a voucher made from a payment request or a petty-cash claim keeps each line's `unit_id`.** Today the edit route re-inserts lines without it, so an edit loses it. Fix and test.
2. **Switching the purpose after lines are filled** sets every line's department and clears what no longer fits:
   - Company drops the units and the project;
   - Rental drops the project.
   - It asks before clearing anything already chosen.
3. **A unit on a line that is not Rental is refused by the server** (`unit_not_rental`), so the ledger never carries a unit on a Renovation or Company line.
4. **A supplier payment that settles bills** (AP control legs) carries no unit and no project, the same rule as projects today.
5. **Every existing report that prints the department** (Reports, General Ledger, journal cards, Receipts, Debtor bill, AP invoice, Payment Requests, Petty Cash) shows "Renovation" for `supply`. The Excel export does the same.

---

### Task 1: SOP, migration, rename

**Files:**
- `docs/finance/FINANCE-SOP.md` 3.2: a dated paragraph with the decisions above.
- `migrations-pg/0193_ledger_unit.sql` (check the number first). Contents:
  - `alter table scm.journal_entry_lines add column if not exists unit_id text`;
  - `create index if not exists idx_jel_unit on scm.journal_entry_lines (company_id, unit_id) where unit_id is not null`.
- `engine/frontend/src/conts/department.tsx` and `claimsQueries.ts` `DEPARTMENT`: the label becomes "Renovation"; the value stays `supply`.
- `PaymentVoucherNew.tsx:556` and `PaymentVoucherDetail.tsx:429`: the message becomes "Rental, Renovation or Shared — the reports by department read it."
- `pages/projects/renovation/CreateRenovationPanel.tsx:110`: "Renovation (showroom)".
- Tests: every frontend test that pins "Supply chain" as the department label (find them with `grep -rn "Supply chain" engine/frontend/src --include=*.test.*`) now pins "Renovation".

- [ ] Write the failing test: `departmentLabel("supply") === "Renovation"` and the `DEPARTMENT_OPTIONS` labels are `["Rental","Renovation","Shared"]`. Then rename, run the department and report tests, and commit `feat(finance): the supply department reads Renovation`.

### Task 2: The unit reaches the ledger

**Files:**
- `engine/backend/src/acc/engine.ts`: `RuleLine.unitId?: string | null`, written to `journal_entry_lines.unit_id`, and copied by a reversal like `project_id`.
- `engine/backend/src/acc/rules.ts`: `pvLines` debit legs take `unit_id`. A leg on the AP control carries none. A unit on a non-rental leg is not stamped (the route refuses it first).
- `engine/backend/src/scm/routes/payment-vouchers.ts`:
  - `LINE` and the posting read (line ~1117) select `unit_id`;
  - the line builder accepts `lines[].unitId`, refusing it unless the line's department is `rental` (`unit_not_rental`) or it is not a known unit (`unit_unknown`, checked against `conts_units` through `sb.schema('public')`);
  - the edit path (line ~956) keeps the `unit_id` it is sent and, when the body omits `unitId` for a line, keeps the stored one by `line_no`.
- Tests: `engine/backend/tests/pvUnit.test.ts`:
  - create with a Rental unit, then post → the expense JE line has the `unit_id`;
  - a reversal copies it;
  - a unit on a Shared line → 400 `unit_not_rental`;
  - an AP-settling voucher → no unit on the control leg;
  - editing a voucher whose lines came from a payment request keeps their `unit_id`.
- [ ] Test first, then the code. Run the voucher tests and `npx tsc -b`, and commit `feat(finance): a voucher line's unit is carried to the ledger`.

### Task 3: Pickers and the purpose switch

**Files:**
- Create `engine/frontend/src/conts/ProjectPicker.tsx`. Props: `{ value: number | null; onChange(id: number | null): void; required?: boolean; disabled?: boolean; inputClass?: string }`.
  - A button shows the chosen project (or "Choose a project…"). It opens a `Modal` with a search box and a `DataTable` laid out as in Global Constraints.
- Create `engine/frontend/src/conts/UnitPicker.tsx`, the same shape with `value: string | null`. It reads the new `GET /accounting/units` → `{ units: [{ id, building, unitNumber }] }` (backend: `conts/units-route.ts`, mounted behind the Ledger guard).
- Pure ordering and search in `engine/frontend/src/conts/pickerRows.ts`:
  - `projectRows(projects, query)` → `{ open: Row[]; completed: Row[]; test: Row[] }`;
  - `unitRows(units, query)`;
  - `cleanProjectName(name)` strips the leading "SO - ".
- `GET /accounting/projects` adds `customer_name, status, reno_stage, planned_handover_date, handed_over_at, closed_at, created_at` to its select, so the picker can sort and label.
- `ProjectLimitField.tsx` uses `ProjectPicker`; the limit line below it stays.
- `ApInvoiceForm.tsx`: the line Project column uses `ProjectPicker`.
- `PaymentVoucherNew.tsx` and `PaymentVoucherDetail.tsx`:
  - a "For" segmented control (Rental / Renovation / Company, plus Mixed on an older voucher), placed before Project;
  - it sets each line's department;
  - on Rental each line gets a `UnitPicker` cell;
  - on Renovation the project is required ("Choose the project this renovation cost belongs to.");
  - the voucher sends `lines[].unitId`.
- Tests:
  - `pickerRows.test.ts`: ordering (open newest first, completed after, test last); search on name, customer and code; "SO - " stripped.
  - `ProjectPicker.test.tsx`: typing "amanda" leaves one row, and clicking it calls `onChange(id)`.
  - `PaymentVoucherNew` purpose tests:
    - Rental shows a Unit cell per line and sets the department to rental;
    - Renovation without a project blocks saving with the message above;
    - switching from Rental to Company asks before clearing units.
- [ ] Test first, then the code. Run the tests and `npx tsc -b` in `engine/frontend`. Check in the preview: the picker at phone width and in dark mode. Commit `feat(finance): voucher purpose, and project and unit pickers`.

### Task 4: Rental costs by unit

**Files:**
- `engine/backend/src/acc/rental-unit-costs.ts`: `GET /accounting/rental-unit-costs?from&to`.
  - It sums EXPENSE lines with `department = 'rental'`, counted as the books count them (`countsInTheBooks`), dated within the range.
  - It returns `{ rows: [{ unitId, building, unitNumber, byAccount: Record<code, sen>, totalSen }], noUnitSen, accounts: [{ code, name }] }`.
  - `noUnitSen` is the Rental expense with no unit (Rental's general cost).
- `engine/frontend/src/conts/RentalUnitCosts.tsx`, at route `/scm/rental-unit-costs`; Sidebar Finance entry "Rental Unit Costs"; route-count pins +1.
  - Date range, one row per unit, a column per account, a total, a "No unit" row, Excel export in RM.
  - A note on the page: "What the company paid for each unit through vouchers. Owner charges are on the owner statement."
- Tests: backend sums, reversals left out, other departments left out, the no-unit row. Frontend: the export is in RM.
- [ ] Test first, then the code. Commit `feat(finance): Rental costs by unit`.

### Task 5: Ship

- [ ] Run the full backend suite. Known failures on main: doStockLeavesOnConfirm, renovationRecords, renovationTimeline, settlementRoutes, soLineFreezeRoutes, specialsRecordedNeverPriced.
- [ ] Have a fresh reviewer go over the branch, and fix the findings test-first.
- [ ] Apply 0193 to production, in one transaction with its `pos_migrations` row; strip any comment containing DROP.
- [ ] Open the PR, merge it, and watch the deploy.
