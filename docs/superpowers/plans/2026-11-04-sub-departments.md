# Sub-departments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ledger line carries a sub-department under its department. chew maintains the list. Renovation lines
pick a brand, then (optionally) one of that brand's projects. Reports show spending per sub-department.

**Architecture:**
- `department` (`rental` / `supply` / `shared`) stays exactly as it is on every line table.
- A nullable `sub_department_id` sits beside it, pointing at a new `scm.acc_sub_departments`.
- A line with no sub-department reads as its department's default: Rental (general), Renovation (Dream Crafter),
  Company. Old rows and old callers therefore keep working.
- One backend module resolves and checks the pair `(department, sub_department_id)`. Every document route calls it.
- The ledger engine copies `sub_department_id` onto journal lines.

**Tech Stack:** Hono on Workers, Supabase PostgREST (`scm` schema), React + React Query, vitest (`fakeSb` in
`engine/backend/src/scm/lib/fake-postgrest.ts`), SQL migrations in `migrations-pg/`.

**Spec:** `docs/superpowers/specs/2026-11-04-sub-departments-design.md`; SOP 1.1, 3.2 and 6 in
`docs/finance/FINANCE-SOP.md`.

## Before starting

- `feat/project-limit-switch` (migration 0206) is committed, applied to production and merged. Start this work on a
  new branch from `origin/main`.
- Check the next free migration number on production (`public.pos_migrations`) and on every remote branch:
  `git ls-tree --name-only <branch> migrations-pg/`. Use 0207 if it is free.

## Global Constraints

- Screens and messages in British English. The labels are exactly:
  - "Rental (general)", "Maintenance", "Cleaning";
  - "Renovation (Dream Crafter)", "In-house Reno (The Conts)";
  - "Company".
- No DROP in production SQL. Use `create or replace`, `add column if not exists` and `on conflict do nothing`.
- New `scm` tables get `grant all … to service_role, pos_app`, are owned by `scm_engine`, and have RLS on.
- Read `public.projects` through `sb.schema('public')`. Tests that touch public tables wrap with `publicTablesOnly`.
- Fixed keys: `rental_general`, `dreamcrafter`, `theconts`, `company`.
  - A fixed row can be renamed and reordered, never retired.
  - Its department never changes.
- Changing the list needs `scm.payment_voucher.post`. Anyone with the Ledger may read it.
- A project's brand comes from `projectRenoKind`: its `finance_kind`, else its brand's (`project_brands.name =
  projects.brand`), else `RENOVATION`.
  - `RENOVATION` goes with `dreamcrafter`.
  - `INHOUSE_RENOVATION` goes with `theconts`.
- Run `npx tsc -b` in `engine/frontend` and `npx tsc --noEmit -p .` in `engine/backend` before every commit.
- Backend tests: `npx vitest run --config vitest.light.config.mts <paths>` from `engine/backend`.
- Frontend tests: `npx vitest run <paths>` from `engine/frontend`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An old voucher opened and saved unchanged.** Its lines keep `sub_department_id` null and their department.
   Nothing moves. (Task 4 test.)
2. **A renovation line whose project is the other brand's.** It is refused with "SKYLINE is a The Conts project.",
   not saved under the wrong brand. This includes a project whose brand changed after the line was saved. (Task 4
   test.)
3. **A retired sub-department still on saved lines.** The lines keep it and reports still show it by name. It is only
   missing from the pickers. (Task 2 test.)
4. **A float with no mapped sub-department** (a staff department chew has not mapped yet). The receipt falls back to
   the department's default and never fails to submit. (Task 6 test.)
5. **Reversing a posted journal.** The contra lines carry the original's `sub_department_id`, so the sub-department
   nets to nothing. (Task 3 test.)

---

### Task 1: Table, columns and the resolver

**Files:**
- Create: `migrations-pg/0207_sub_departments.sql`
- Create: `engine/backend/src/conts/sub-departments.ts`
- Test: `engine/backend/src/conts/sub-departments.test.ts`

**Interfaces:**
- Produces:
  - `type SubDepartment = { id: string; department: Department; name: string; fixedKey: FixedKey | null; staffDepartmentId: string | null; active: boolean; sort: number }`
  - `type FixedKey = 'rental_general' | 'dreamcrafter' | 'theconts' | 'company'`
  - `loadSubDepartments(sb, companyId): Promise<{ ok: true; list: SubDepartment[] } | { ok: false; error: string }>`
  - `defaultSubDepartment(list, department): SubDepartment` (the fixed row of that department)
  - `resolveLineSub(list, { department?: unknown; subDepartmentId?: unknown }): { ok: true; department: Department; subDepartmentId: string | null } | { ok: false; error: 'sub_department_invalid' | 'sub_department_mismatch'; message: string }`
  - `projectRenoKind(sb, companyId, projectIds: number[]): Promise<Map<number, 'RENOVATION' | 'INHOUSE_RENOVATION'>>`
  - `subForStaffDepartment(list, staffDepartmentId: string | null, fallback: Department): SubDepartment`

- [ ] **Step 1: Write the migration**
  - Create `scm.acc_sub_departments`:
    - `id uuid pk default gen_random_uuid()`;
    - `company_id bigint not null references public.companies(id)`;
    - `department text not null check (department in ('rental','supply','shared'))`;
    - `name text not null`;
    - `fixed_key text check (fixed_key in ('rental_general','dreamcrafter','theconts','company'))`;
    - `staff_department_id text`;
    - `active boolean not null default true`;
    - `sort integer not null default 0`;
    - `unique (company_id, fixed_key)` and `unique (company_id, department, name)`.
  - Seed, for every row of `public.companies`, with `on conflict do nothing`:
    - Rental: the four fixed rows, plus "Maintenance" and "Cleaning" under `rental`;
    - Maintenance and Cleaning are mapped to the `conts_departments` row of the same name, where it exists.
  - Add `sub_department_id uuid references scm.acc_sub_departments(id)` (nullable) to:
    - `scm.journal_entry_lines`, `scm.payment_voucher_lines`, `scm.acc_receipt_lines`;
    - `scm.ap_invoice_lines`, `scm.acc_debtor_bill_lines`;
    - `scm.staff_receipt_lines`, `scm.payment_request_lines`.
  - `create or replace view scm.v_gl_entries` with `sub_department_id` appended last. Copy the current definition from
    the newest migration that defines it.
  - End with `notify pgrst, 'reload schema'`.

- [ ] **Step 2: Write the failing tests**

```ts
test('no sub-department reads as the department default', () => {
  expect(resolveLineSub(list, { department: 'rental' })).toEqual({ ok: true, department: 'rental', subDepartmentId: null });
});
test('a sub-department sets its department', () => {
  expect(resolveLineSub(list, { department: 'supply', subDepartmentId: CLEANING })).toEqual({ ok: true, department: 'rental', subDepartmentId: CLEANING });
});
test('an unknown sub-department is refused', () => {
  expect(resolveLineSub(list, { subDepartmentId: 'nope' })).toMatchObject({ ok: false, error: 'sub_department_invalid' });
});
test('a retired sub-department is still accepted on a line that already had it', () => {
  // resolveLineSub(list, { subDepartmentId: RETIRED }, { saved: RETIRED }) → ok
});
test('projectRenoKind: own kind, else brand, else renovation', async () => {
  // projects 7 { finance_kind: 'INHOUSE_RENOVATION' }, 8 { brand: 'The Conts' } with project_brands { name: 'The Conts', finance_kind: 'INHOUSE_RENOVATION' }, 9 {}
  // → Map { 7 → INHOUSE_RENOVATION, 8 → INHOUSE_RENOVATION, 9 → RENOVATION }
});
test('a staff department with no mapping falls back to the department default', () => {
  expect(subForStaffDepartment(list, 'dept-unmapped', 'rental').fixedKey).toBe('rental_general');
});
```

  `resolveLineSub` takes an optional third argument, `{ saved?: string | null }`. A retired row is accepted only when
  it equals `saved`.

- [ ] **Step 3: Run the tests.** Expected: FAIL, because the module does not exist yet.
- [ ] **Step 4: Implement `sub-departments.ts`** with the signatures above. The sort order is department
  (`rental`, `supply`, `shared`), then `sort`, then `name`.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit:** `feat(departments): sub-departments under each department, and the resolver`.

### Task 2: chew maintains the list (Ledger setup → Departments)

**Files:**
- Create: `engine/backend/src/conts/sub-department-routes.ts`, plus its test
- Modify: `engine/backend/src/scm/routes/accounting.ts` (mount next to `/project-limit-settings`)
- Create: `engine/frontend/src/conts/SubDepartments.tsx`, `engine/frontend/src/conts/subDepartmentQueries.ts`, plus
  the test
- Modify: `engine/frontend/src/conts/LedgerSetup.tsx` (render after `ProjectLimitSettings`), `LedgerSetup.test.tsx`
  (mock it)

**Interfaces:**
- Consumes: `loadSubDepartments`, `SubDepartment` (Task 1).
- Produces:
  - `GET /accounting/sub-departments` → `{ subDepartments: SubDepartment[] }`, inactive ones included;
  - `POST /accounting/sub-departments { department, name, staffDepartmentId? }`;
  - `PUT /accounting/sub-departments/:id { name?, staffDepartmentId?, active?, sort? }`;
  - `useSubDepartments()`, `useSaveSubDepartment()` (frontend).

- [ ] **Step 1: Failing route tests**
  - Without `scm.payment_voucher.post`, POST and PUT return 403.
  - POST "Laundry" under `rental` returns 201.
  - A duplicate name in the same department returns 409 with "Rental already has Laundry.".
  - PUT `active: false` on a fixed row returns 409 with "Rental (general) is built in: rename it, never retire it.".
  - PUT `department` is ignored: the department never changes.
  - An empty name returns 400.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the routes.**
- [ ] **Step 4: Failing screen test**
  - The list is grouped under the headings Rental / Renovation / Company.
  - Adding "Laundry" under Rental calls the save with `{ department: 'rental', name: 'Laundry' }`.
  - Fixed rows have no Retire button.
  - A retired row shows "Retired" and a Bring back button.
  - Without the key, every input is disabled.
  - Each row has a staff-department `<select>` filled from `/accounting/staff-departments`. If no such route exists,
    add a GET to `sub-department-routes.ts` that reads `public.conts_departments` (`id, name`).
- [ ] **Step 5: Implement `SubDepartments.tsx`.** Follow the style of `ProjectLimitSettings.tsx` (same section card).
  A rename saves on blur. Retiring asks first: "Retire Laundry? Lines that already name it keep it; it is no longer
  offered on new lines."
- [ ] **Step 6: Run both tests.** Expected: PASS. Then commit:
  `feat(departments): finance keeps the sub-department list on Ledger setup`.

### Task 3: The ledger carries the sub-department

**Files:**
- Modify: `engine/backend/src/acc/rules.ts`
  - `RuleLine` gains `subDepartmentId?: string | null`.
  - `apInvoiceLines` and `pvLines` copy it from their source lines onto the cost lines. Control and bank legs stay null.
- Modify: `engine/backend/src/acc/engine.ts`
  - The insert at around line 305 writes `sub_department_id: l.subDepartmentId ?? null`.
  - The reversal (around lines 443–530) selects it and copies it onto the contra line.
- Modify: `engine/backend/src/scm/routes/accounting-journal-edit.ts`
  - Manual journal lines accept `subDepartmentId` through `resolveLineSub`.
- Modify: `engine/backend/src/conts/petty-cash-ledger.ts`
  - `ReceiptLineForJournal` gains `subDepartmentId?` and `unitId?`. Both are copied, so petty cash units reach Rental
    Unit Costs.
- Modify: the debtor bill and receipt builders that read `acc_debtor_bill_lines` / `acc_receipt_lines`
  (`scm/routes/other-debtors.ts`, `scm/routes/receipts.ts`): copy the line's `sub_department_id`.
- Test: `engine/backend/src/acc/rules.test.ts`, the engine posting test file next to `engine.ts`,
  `conts/petty-cash-ledger.test.ts`.

**Interfaces:**
- Consumes: `resolveLineSub` (Task 1).
- Produces: `journal_entry_lines.sub_department_id` is filled for every cost line whose source line has one.

- [ ] **Step 1: Failing tests**
  - `pvLines` with a Cleaning line gives a debit line `{ department: 'rental', subDepartmentId: CLEANING }`, and the
    bank leg has no sub-department.
  - Posting writes `sub_department_id`.
  - Reversing copies it onto the contra line (Review Focus 5).
  - A petty cash journal line carries `unit_id` and `sub_department_id`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the changes in the files above.**
- [ ] **Step 4: Run the tests, then the whole light suite.** Expected: PASS, apart from the 7 failures that also
  happen on plain main (doStockLeavesOnConfirm, renovationBeta, renovationRecords, renovationTimeline,
  settlementRoutes, soLineFreezeRoutes ×2).
- [ ] **Step 5: Commit:** `feat(ledger): journal lines keep their sub-department`.

### Task 4: Payment voucher lines pick a sub-department

**Files:**
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`
  - The line builder around lines 270–295 reads `subDepartmentId` and sets `department` through `resolveLineSub`.
  - `lineProjects` (around line 250) checks the brand: a project on a `dreamcrafter` line must be `RENOVATION`, and on
    a `theconts` line `INHOUSE_RENOVATION`. An internal Rental project needs a Rental sub-department.
  - `LINE` (line 101) selects `sub_department_id`.
- Modify: `engine/backend/src/conts/project-limit.ts`
  - `lineDepartmentOfProject` stays, for lines sent without a sub-department.
- Modify (frontend):
  - `engine/frontend/src/conts/voucherPurpose.ts` and `VoucherLineFor.tsx`: the Unit / Project / Company switch
    becomes a sub-department picker, grouped by department.
  - The project picker is shown for the two renovation sub-departments and for Rental ones. For renovation it is
    filtered by `projectRenoKind`; it is optional.
  - The unit picker is shown for Rental sub-departments, placed first for any sub-department other than Rental
    (general).
  - `/accounting/projects` returns `reno_kind` for each project (from `projectRenoKind`), so the filter runs in the
    browser.
  - `ProjectLimitField.tsx`: drop the `required` rule for Renovation. Search for the 2 Nov message and remove it on
    both sides.
  - `PaymentVoucherNew.tsx` and `PaymentVoucherDetail.tsx` send `subDepartmentId` per line.
- Test: `payment-vouchers` route tests, `voucherPurpose.test.ts`, `PaymentVoucherNew.test.tsx`,
  `PaymentVoucherDetail.test.tsx`.

**Interfaces:**
- Consumes: `resolveLineSub`, `projectRenoKind` (Task 1). `ProjectOption` gains `reno_kind`.
- Produces: `payment_voucher_lines.sub_department_id`. A new line's default is the line above's sub-department and
  project.

- [ ] **Step 1: Failing tests**
  - A line `{ subDepartmentId: THECONTS }` with no project saves `{ department: 'supply', sub_department_id: THECONTS, project_id: null }`.
  - The same line with a Dream Crafter project returns 400 with "SKYLINE is a Dream Crafter project." (Review
    Focus 2).
  - An old voucher's lines, saved with no `subDepartmentId`, keep a null sub-department and their department (Review
    Focus 1).
  - On screen, choosing "In-house Reno (The Conts)" lists only The Conts projects, and the project can be left empty.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS. Then commit:
  `feat(vouchers): each line names its sub-department; a renovation line names its brand, the project is optional`.

### Task 5: AP invoices, debtor bills, manual journals and receipts

**Files:**
- Create: `engine/frontend/src/conts/SubDepartmentSelect.tsx`
  - `SubDepartmentSelect({ value, onChange, label, includeRetired?: string | null })` shows active rows grouped by
    department, plus the line's own retired row.
- Modify: `engine/frontend/src/conts/department.tsx`
  - `departmentLabel` gains `subDepartmentLabel(list, line)`.
  - `DepartmentSelect` stays for report filters.
- Modify (screens): replace the line-level `DepartmentSelect` with `SubDepartmentSelect` in:
  - `pages/scm-v2/ApInvoiceForm.tsx`, `DebtorBillForm.tsx`, `JournalEntryCards.tsx`, `Receipts.tsx`.
- Modify (backend): accept `subDepartmentId` through `resolveLineSub` in:
  - `scm/routes/ap-invoices.ts`, `other-debtors.ts`, `receipts.ts`, `accounting-journal-edit.ts`.
- Test: each route's existing test file gets one test; each screen's test file gets one test.

- [ ] **Step 1: Failing tests (one per route)**
  - A line with a Maintenance sub-department saves `department: 'rental'` and the id.
  - A line with an unknown id returns 400 with `sub_department_invalid`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the backend part, then the screens.**
- [ ] **Step 4: Screen tests**
  - The picker shows the three department headings.
  - A new line takes the line above's sub-department.
- [ ] **Step 5: Run everything in this task.** Expected: PASS. Then commit:
  `feat(departments): bills, journals and receipts name a sub-department`.

### Task 6: Staff receipts and payment requests take their default

**Files:**
- Modify: `engine/backend/src/conts/petty-cash-routes.ts`, `petty-cash-store.ts`, `payment-request-routes.ts`,
  `my-claims-routes.ts`
- Modify: `engine/frontend/src/conts/ClaimsParts.tsx`, `PaymentRequests.tsx`
- Test: their existing test files

**Defaults:**
- A receipt on a float takes `subForStaffDepartment(list, float.department_id, …)`.
- A receipt with a maintenance job takes Maintenance. The job's unit is kept, as today.
- A payment request takes `subForStaffDepartment(list, submitter's department_id, …)`.
- The person can change any of them.
- The fallback department is today's: the line's `department`.
- When a request becomes a voucher (`payment-request-routes.ts` around line 289), `sub_department_id` is copied onto
  the voucher line.
- When a receipt is booked, its journal lines carry it (Task 3).

- [ ] **Step 1: Failing tests**
  - A receipt from the Cleaning float with no unit saves the Cleaning sub-department, not Rental (general).
  - A float whose department is unmapped saves the department default and submits (Review Focus 4).
  - A request by a Maintenance technician defaults to Maintenance.
  - A request's voucher line carries its `sub_department_id`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - On screen, the sub-department picker replaces the department picker, pre-filled with the default.
  - For Maintenance and Cleaning the unit field comes first.
  - A line left without a unit shows "No unit".
- [ ] **Step 4: Run the tests.** Expected: PASS. Then commit:
  `feat(claims): receipts and requests take the sub-department of the float or the person`.

### Task 7: An internal Renovation project picks its brand

**Files:**
- Modify: `engine/backend/src/conts/project-limit.ts` `fundingFrom`. With `funding: 'internal'` and
  `internalDepartment: 'supply'`, it requires `financeKind` in `RENOVATION | INHOUSE_RENOVATION`. Otherwise it returns
  `{ ok: false, error: 'brand_required' }`.
- Modify: `engine/backend/src/routes/renovation.ts` (around line 239). The `UPDATE projects` also sets `finance_kind`.
- Modify: `engine/frontend/src/pages/projects/renovation/CreateRenovationPanel.tsx`. For an internal Renovation
  project, add a required "Brand" select: "Dream Crafter" or "The Conts".
- Test: `project-limit.test.ts` (`fundingFrom`), and the panel's test.

- [ ] **Step 1: Failing tests**
  - `fundingFrom({ funding: 'internal', internalDepartment: 'supply', budgetSen: 100 })` →
    `{ ok: false, error: 'brand_required' }`.
  - With `financeKind: 'INHOUSE_RENOVATION'`, it returns ok with that kind.
  - An internal Rental project needs no brand.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS. Then commit:
  `feat(projects): an internal renovation project names its brand`.

### Task 8: Reports by sub-department

Invoke the `dashboard-design` skill before changing these screens.

**Files:**
- Modify: `engine/backend/src/acc/rules.ts`. Add
  `subDepartmentQuery(raw): string | null | false`, alongside `departmentQuery`.
- Modify: `engine/backend/src/scm/routes/accounting-reports.ts`
  - `loadSums` takes `subDepartmentId`. A default sub-department also matches null rows of its department.
  - The P&L gains `bySubDepartment`: for each department, rows `{ subDepartmentId, name, amounts }` that add up to the
    department total.
- Modify: `engine/backend/src/scm/routes/accounting-ledger.ts` (the same filter).
- Modify: `engine/backend/src/acc/rental-unit-costs.ts`. Add a `subDepartment` column, plus
  `GET /accounting/no-unit-costs?from&to`, which lists Maintenance and Cleaning lines that have no unit.
- Modify: `engine/frontend/src/pages/scm-v2/Reports.tsx`, `GeneralLedger.tsx` and the Rental Unit Costs page.
  - Add a Sub-department filter under Department.
  - The P&L shows each department's sub-departments as indented rows.
  - Add a "No unit" tab.
- Test: `accounting-reports` tests and `rental-unit-costs` tests.

- [ ] **Step 1: Failing tests**
  - Cleaning RM 50 with unit A-12-06 appears once under Rental → Cleaning in the P&L.
  - It appears once under A-12-06 in Rental Unit Costs, labelled Cleaning.
  - The company total counts it once.
  - A null-sub Rental line is counted under Rental (general).
  - A Cleaning line with no unit appears in the no-unit list.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS. Then commit:
  `feat(reports): spending by sub-department; costs with no unit`.

### Task 9: Tag the November records (go-live)

**Files:**
- Create: `scripts/sub-department-backfill.sql`. Not a migration: it is run by hand after the code is live, on
  chew's go.

**Rules, in order, only for rows dated from 2026-11-01 whose `sub_department_id` is null:**
1. A `staff_receipt_lines` row with `maintenance_issue_id` gets Maintenance.
2. A receipt line on a float gets the sub-department mapped to the float's staff department.
3. A `supply` line with a project gets `theconts` or `dreamcrafter` by the project's kind.
4. The same tags are copied to the journal lines those documents posted. The match is `source_type` +
   `source_doc_no` + `line_no` order.
5. Everything else stays null, which reads as Rental (general) or Renovation (Dream Crafter).

- [ ] **Step 1:** Write the SQL as `update … where sub_department_id is null`, one statement per rule. Start with a
  `select` that counts how many rows each rule would change.
- [ ] **Step 2:** Run only the counting `select` on production. Show chew the counts.
- [ ] **Step 3:** Once chew says go, run the updates in one transaction. Re-run the count, which should be 0 rows left
  per rule.
- [ ] **Step 4:** Commit the script: `chore(departments): tag November's lines with their sub-department`.

---

## Self-review notes

- Spec 1 (two levels) → Tasks 1–2. Spec 2 (brand, then project) → Task 4. Spec 3 (every document) → Tasks 4–6.
  Spec 4 (chew maintains) → Task 2. Spec 5 (defaults) → Tasks 4 and 6. Spec 6 (unit first, "No unit") → Tasks 4, 6
  and 8. Spec 7 (counted once) → Task 8. Spec 8 (reports) → Task 8. Spec 9 (records) → Task 9. Answer 10 → Task 7.
  Answer 11 → the seed has one Company row. Answer 12 → Task 2.
- Task 4 is the largest and most likely to need splitting. If its screen half grows, split it into 4a (backend) and
  4b (screen) at the commit boundary.
