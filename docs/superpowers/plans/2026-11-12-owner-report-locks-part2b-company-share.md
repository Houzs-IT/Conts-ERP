# Owner report locks, part 2b (company share, fixed rent, notices) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finish part 2 of the owner statement close.
- **Company share.** A late change to a locked month reaches the company's own figures in the month the owner's share goes to (chew's choice A).
- **Fixed rent.** Fixed-rent units join the Income and Deductions steps.
- **Reservation notice.** The person who edits a reservation in an income-locked month is told where the difference goes.
- **Lock powers.** The four lock and unlock powers open only when someone ticks them on their own.

**Architecture:**
- **Store.** A new table, `company_late_changes` (migration 0304), keeps the company's share of each lock's late difference: one row per lock per month, like the owner adjustment the late update keeps for the owner.
- **Sync.** `syncLate` works out the company figure the same three ways it works out the owner's payout:
  - the figure is `gross − deductions − payoutBeforeAdjustments`;
  - the three ways are as the statement takes it, with today's income, and live;
  - `splitLate` splits it between the income and deductions locks;
  - the row goes on the same target month as the owner's adjustment, under the same advisory lock.
- **Unlock.** `unlockStage` withdraws what can still move and carries back what is settled, as it does for owner adjustments.
- **Reports.** The four company views read the rows through one helper and add them to the company's result:
  - the Overall owner report;
  - the Yearly report;
  - Finance › Unit P&L;
  - the unit's Financials.

**Tech Stack:** as parts 1 and 2a:
- Cloudflare Pages Functions (TypeScript), Postgres schema `pos`;
- React with the project's `DataTable`, toast and tokens;
- `node --test src/lib/*.test.mjs` for pure rules;
- `scripts/api-checks/*.mjs` against local PGlite with `wrangler pages dev`.

**Spec:** `docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md`. Earlier plans:
- `…-part1-income.md`;
- `…-part2a-deductions-o2.md`, whose "Where this sits" lists 2b.

chew's decisions:
- 11 Nov 2026: "A：算进下个月" (FINANCE-SOP §9.1);
- 12 Nov 2026: "开始 2b", after being told 2b includes the lock-power fix.

## Global Constraints

Everything in the 2a plan's Global Constraints holds:
- British English copy; no CJK in `src/`;
- the vocabulary check;
- no lock before 2026-10;
- only ticked units are locked;
- reasons on unlock;
- migrations through `migrate-production.yml` (dry run first, chew's OK each time);
- production SQL through MCP is insert/update only;
- `rbac-matrix.expected.json` keeps CRLF;
- `tsc -b` run on its own;
- toast tones are success, warning, critical, info and neutral.

New here:
- **Company figure of a unit-month.**
  - Formula: `gross − deductions − payoutBeforeAdjustments`, from the statement engine.
  - It equals the reports' Gain / Loss (`GP − owner base`) on every basis: share, guarantee, long-term let and fixed rent.
  - Exception: the true-up month of a yearly guarantee, where the reports leave the top-up out on purpose.
- **Where a company row lands.** On the same month as the owner's late adjustment would: the first month after the locked month that is neither O2-locked nor final for the unit (`openMonthAfter` over `closedMonthsFor(…, 'o2')`).
- **When a company row is settled.** Once its month is O2-locked or final for the unit, it never moves again. Later differences go to a new row on the next open month.
- **A company row is never held**, even when the owner's adjustment is (yearly guarantee).
- **Who is on Income and Deductions:**
  - share and long-term lets (basis `share`);
  - fixed rent (basis `fixed_rent`);
  - not a master lease (basis `none`), which has no owner statement.
  - O2 is unchanged.
- **Own-grant powers:** `lockIncome`, `lockDeductions`, `lockO2` and `unlockStep`.
  - They never take a level from a category baseline.
  - The Finance group's ticks in Users and roles leave them alone.
  - An explicit setting for a person, position or department still works.
  - Part 3's Make final and Unlock final will join the list.
- **Copy:** every message about a locked month comes from `stageLocks.ts`, as in 2a.

## Review Focus

1. **A unit with income and deductions both locked, then a reservation change that moves occupancy (misc charge on).**
   - The company's misc difference goes with income, as the owner's does.
   - The two company rows add up to the live company figure less the locked one.
   - Tested in Task 2 (C3).
2. **A company row whose month is O2-locked afterwards, then the source month is unlocked.**
   - The settled row stays.
   - The unlocked month gets a carried row of the opposite amount.
   - Across the months, the company counts the change once.
   - Tested in Task 2 (C5).
3. **A reservation spanning two months, only the first income-locked:**
   - edited: the notice names only the locked month;
   - moved wholly into open months: no notice when neither the old nor the new range touches a locked month.
   - Tested in Task 5 (N2, N3).
4. **A department given the whole Finance group at Edit** (category baseline or the group tick in Users and roles).
   - Its people cannot lock or unlock.
   - Ticking Lock income on its own row still gives that one power.
   - Tested in Task 6.
5. **The three report libraries must agree.** The Overall owner report's Gain / Loss, the Yearly report's The Conts and Finance › Unit P&L's Company keeps all include the same company row for the month. Tested in Task 3 (the existing cross-checks plus R1–R3).

---

### Task 1: Pure rules

**Files:**
- Modify: `functions/_lib/stageLocks.ts`
- Test: `src/lib/stageLocks.test.mjs`

**Interfaces:**
- Produces:
  - `lockable(stage, basis)`:
    - income and deductions: `basis === 'share' || basis === 'fixed_rent'`;
    - o2: always.
  - `companyFigure(m: { gross: number; deductions: number; payoutBeforeAdjustments: number }): number`, which returns `gross − deductions − payoutBeforeAdjustments`.
  - `companyCarriedText(labels: string[]): string`, which returns `Already counted in ${labels.join(' and ')}`.
  - `incomeNoticeText(unitLabel: string, lockedLabels: string[], toLabel: string | null): string`, which returns `${lockedLabels.join(' and ')} income ${is|are} locked for ${unitLabel}.` followed by:
    - with one locked month and `toLabel`: `The difference goes to ${toLabel}.`;
    - otherwise: `The difference goes to the next open month.`
  - `rolledText(unitLabel, fromLabel, toLabel, why, fixedRent = false)`: with `fixedRent`, the second sentence is `This cost counts in ${toLabel}.`
  - `editedText(unitLabel, label, fixedRent = false)`: with `fixedRent`, the second sentence is `${label} keeps the old amount; the difference counts in the next open month.`

- [ ] **Step 1: Write the failing tests** in `src/lib/stageLocks.test.mjs`:
  - `lockable('income', 'fixed_rent') === true`, `lockable('deductions', 'fixed_rent') === true`, `lockable('income', 'none') === false`, `lockable('o2', 'none') === true`;
  - `companyFigure({ gross: 10000, deductions: 2000, payoutBeforeAdjustments: 6000 }) === 2000`;
  - `incomeNoticeText('Vista 22-04', ['October 2026'], 'November 2026') === 'October 2026 income is locked for Vista 22-04. The difference goes to November 2026.'`;
  - two labels, null target → `'October 2026 and November 2026 income are locked for Vista 22-04. The difference goes to the next open month.'`;
  - `rolledText('Vista 22-04', 'October 2026', 'November 2026', 'locked', true) === 'October 2026 deductions are locked for Vista 22-04. This cost counts in November 2026.'`;
  - `editedText('Vista 22-04', 'October 2026', true) === 'October 2026 deductions are locked for Vista 22-04. October 2026 keeps the old amount; the difference counts in the next open month.'`;
  - `companyCarriedText(['November 2026']) === 'Already counted in November 2026'`.
  - The existing `lockable` test that expects fixed rent to be refused changes to the new rule. That is the only old expectation that changes.
- [ ] **Step 2: Run** `node --test src/lib/stageLocks.test.mjs`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** them in `stageLocks.ts`. Update the `lockable` comment: fixed rent joins, since its locks freeze the company's figures, which now carry late changes.
- [ ] **Step 4: Run** `node --test src/lib/stageLocks.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(locks): rules for the company share, fixed rent and reservation notice`.

### Task 2: Company late store and the late update

**Files:**
- Create: `migrations-pg/0304_company_late_changes.sql`
- Modify:
  - `functions/_lib/ownerStatement.ts`: add `hasCompanyLateTable(q)` next to `hasLocksTable`, the same way;
  - `functions/_lib/ownerLocks.ts`: `syncLate`, `unlockStage`, and a new `companyLateFor`.
- Test: `scripts/api-checks/owner-close-late.mjs` (new), plus a CI step in `.github/workflows/ci.yml` after owner-close-steps.

**Interfaces:**
- Consumes:
  - `companyFigure`, `companyCarriedText` and `splitLate` from Task 1;
  - `planLate`, `planUnlock` and `PostedLate` as they are.
- Produces:
  - Table `company_late_changes`:
    - `id TEXT PRIMARY KEY`;
    - `unit_id TEXT NOT NULL REFERENCES units(id)`;
    - `month TEXT NOT NULL`, checked `^\d{4}-(0[1-9]|1[0-2])$`;
    - `amount INTEGER NOT NULL` (sen, the company's share);
    - `description TEXT NOT NULL`;
    - `reference TEXT NOT NULL`: `stage-lock:<lockId>`, or `stage-lock-carried:<lockId>`;
    - `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`;
    - indexes on `(unit_id, month)` and `(reference)`.
    - Owned by `pos_app` with full grants. The migration is wrapped in `demo.drop_views()` / `demo.sync()` like 0302, with the APPLY and REVERSAL header.
  - `syncLate(...)` returns what it returned before, plus `company: { inserted: number; updated: number; removed: number }`.
  - `companyLateFor(env: Env, unitIds: string[] | null, fromMonth: string, toMonth: string): Promise<Map<string, { amount: number; items: { label: string; amount: number }[] }>>`:
    - keyed `${unitId}|${month}`;
    - covers months fromMonth to toMonth, both included;
    - `label` is the row's description;
    - with no table: an empty map.

How the late update posts company rows:
- **Diff.** In the loop that builds `due`, the company diff of each lock is `splitLate` run on `companyFigure` of `s`, `x` and `v`. Store it on the `due` entry as `companyDiff`.
- **Posted rows.** Read them per lock, `reference = 'stage-lock:' || lockId`. A row is `movable` when its month is not in the unit's closed set: the `closed` map the loop already has. Pass `PostedLate[]` to `planLate(companyDiff, posted, target)`.
- **Writes.** Insert, update or delete in the same transaction as the owner adjustments, after `takeLateIncomeLock`.
  - Id: `clc-${crypto.randomUUID()}`.
  - Description: `lateText(stage, unitLabel, monthLabel(month))`.
- **Audit.** One entry per write, action `owner_report.late_company.<kind>`, actor label `Late company update`, source `system`.
- **Unlock.** `unlockStage` reads the lock's company rows and runs `planUnlock(posted, final, label)` on them:
  - it deletes the movable ones;
  - for a carried total, it inserts one row of the opposite amount on the same month the owner's carried line uses (the unlocked month, or the first month from it whose O2 is open);
  - that row's reference is `stage-lock-carried:<lockId>` and its description is `companyCarriedText(months)`.

Checks in `owner-close-late.mjs`. It makes its own owner ("Late Owner"), building ("Late Court") and units, and removes them at the end, as owner-close-steps does. The sync is triggered by generating the owner's statement.
- **C1.** Share unit, 80% owner, no guarantee. Lock October income, then raise an October reservation's booking value by RM 100.
  - One `company_late_changes` row on 2026-11 with amount = live company figure − locked company figure (RM 20).
  - The owner adjustment is RM 80.
- **C2.** Generate again: no new row, same amount.
- **C3.** Lock October deductions too, with the misc charge on. Then change an October reservation's dates so occupancy moves.
  - The income lock's company row carries the misc part.
  - The deductions lock's company row is unchanged.
  - The two rows add up to the live company figure − the locked one (±1 sen).
- **C4.** Lock November O2, change October again. The new difference goes on a 2026-12 row. The 2026-11 row stays as it was.
  - November has not ended, so the route refuses that lock. The check inserts the O2 lock row straight into `owner_report_locks`, as owner-close-steps does for its later months.
- **C5.** Unlock October income with a reason.
  - The 2026-12 row (movable) is deleted.
  - The settled 2026-11 row stays.
  - A carried row of the opposite amount lands on October.
  - The company total over October to December equals the live October change.
- **C6.** A second generate after the unlock writes nothing.

- [ ] **Step 1: Write the migration and the check** (C1–C6), with a CI step `Owner statement close, company share (owner-close-late)`: `node scripts/api-checks/owner-close-late.mjs`.
- [ ] **Step 2: Run the check** against a fresh PGlite (the 2a recipe) and the wrangler API built from this branch. Expected: C1–C6 FAIL (no rows posted), with the table present.
- [ ] **Step 3: Implement** `hasCompanyLateTable`, the `syncLate` and `unlockStage` changes, and `companyLateFor`.
- [ ] **Step 4: Run the check.** Expected: C1–C6 pass. Then run `owner-close-steps.mjs` and `owner-close.mjs`. Expected: still all ok.
- [ ] **Step 5: Commit** `feat(locks): the company's share of a late change (choice A)`.

### Task 3: Company views read the late rows

**Files:**
- Modify:
  - `src/lib/ownerOverall.ts`, `src/lib/yearlyReport.ts`, `src/lib/unitPnl.ts`;
  - `functions/api/portfolio/owner-report.ts`, `functions/api/finance/yearly-report.ts`, `functions/api/finance/unit-pnl.ts`;
  - `functions/_lib/unitPnl.ts` (the unit's Financials);
  - `src/pages/OwnerOverallReportPage.tsx`, `src/pages/OwnerOverallDetail.tsx`, `src/pages/YearlyReportPage.tsx`, `src/pages/UnitPnlPage.tsx`.
- Test:
  - `src/lib/ownerOverall.test.mjs`, `src/lib/yearlyReport.test.mjs`, `src/lib/unitPnl.test.mjs`;
  - checks R1–R3 in `owner-close-late.mjs`.

**Interfaces:**
- Consumes: `companyLateFor` (Task 2).
- Produces:
  - **Overall owner report:**
    - `OverallInput.late: number` (sen, the company's share of late changes landing this month);
    - `gainLoss = gp − ownerBase + late`;
    - `'late'` is added to `SUMMED`.
  - **Yearly report:**
    - `YearlyRow.late: number`;
    - `figures(...).company = gp − ownerBase + late`;
    - a new `late` block right after `company`, labelled `The Conts: late changes`.
  - **Finance › Unit P&L:**
    - `UnitMonthInput.late: number`;
    - `LINE_KEYS` gains `'late'` between `owner` and `company`, labelled `Late changes (company's share)`;
    - `company = operating − owner + late`.
  - **The unit's Financials:** a `companyPnl` row `Late changes from locked months`:
    - type `adjustment`;
    - items: the rows' descriptions and amounts;
    - only when non-zero;
    - included in "The Conts' result" on both the share and the fixed-rent branches.

Rows:
- A unit whose only figure in a month is a late row still gets a row that month in all three reports.
- The three routes otherwise skip a unit-month with no activity (`hasActivity`). Each route keeps a unit-month when `companyLateFor` has an amount for it.

Screens:
- **Overall owner report.**
  - A `Late changes` column just before Gain / Loss, shown only when some row in the month has one. Its total row adds up.
  - The drawer's breakdown gets a `+ Late changes from locked months` line before `= Gain / Loss`, only when non-zero.
- **Yearly report.** The `late` block is shown only when some cell in the year is non-zero.
- **Finance › Unit P&L.** The `late` line is shown only when non-zero somewhere in the range.

Tests:
- **Unit tests.** One case per library: a row with `late: 2000` gives company / gainLoss 2000 higher. The existing cross-check tests between the three libraries pass with `late` set on both sides.
- **R1.** After C1, `GET /api/portfolio/owner-report?month=2026-11`: the unit's row has `late` RM 20.
- **R2.** `GET /api/finance/yearly-report?year=2026`: November's row for the unit has `late` RM 20.
- **R3.** `GET /api/finance/unit-pnl?from=2026-11&to=2026-11`: the unit's row has `late` RM 20.
- R1–R3 run between C1 and C3, before later steps change the amounts.

- [ ] **Step 1: Write the failing tests** (the three unit tests, R1–R3).
- [ ] **Step 2: Run** `node --test src/lib/ownerOverall.test.mjs src/lib/yearlyReport.test.mjs src/lib/unitPnl.test.mjs` and the check. Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the libraries, the three routes (each loads `companyLateFor` for its units and months), the unit's Financials and the screens.
- [ ] **Step 4: Run** the unit tests, the check, `unit-pnl.mjs`, `yearly-report.mjs` and `npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Check the screens in the browser** with a late row present: the November column, the drawer line and the block or line, in light and dark, and at 375 px.
- [ ] **Step 6: Commit** `feat(reports): the company's share of late changes in the company views`.

### Task 4: Fixed-rent units on Income and Deductions

**Files:**
- Modify:
  - `functions/_lib/lockGuards.ts`: `basisOf`, and the fixed-rent copy in `costNotice` / `editNotice`;
  - `functions/api/owner-close/index.ts`: `basis` on each unit;
  - `src/pages/owners/OwnerReportClosePage.tsx`:
    - a muted `Fixed rent` tag in the unit cell on the Income and Deductions steps;
    - notLockable copy `a master lease is not on this step`.
- Test: checks G1–G4 in `owner-close-late.mjs`.

**Interfaces:**
- Consumes:
  - `lockable` and the fixed-rent copy from Task 1;
  - the company rows from Task 2.
- Produces:
  - `basisOf(env: Env, unitId: string, month: string): Promise<'share' | 'fixed_rent' | 'none'>`. It reads `loadInputs` for the unit and month, then `termsFor(unitForMonth(u, month))`.
  - `CloseUnit.basis`.

Checks. The check's second unit `ocl-g` has a contract with `revenue_model 'grr'` and `grr_amount` RM 1,500.
- **G1.** October income and deductions both list it, and both lock it.
- **G2.** Raise an October reservation by RM 100 and generate. Then:
  - no owner adjustment for the unit;
  - a company row on 2026-11 of RM 100.
- **G3.** Add an owner-charged cost dated October. Then:
  - it rolls to November (`rolled`);
  - the notice reads `… This cost counts in November 2026.`;
  - changing a locked October cost by RM 10 makes a company row of −RM 10.
- **G4.** The October statement for the owner still shows the fixed rent only.

- [ ] **Step 1: Write G1–G4.**
- [ ] **Step 2: Run** the check. Expected: G1 FAILS (not on the step), G3's copy FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `owner-close-late.mjs`, `owner-close-steps.mjs` and `owner-close.mjs`. Expected: all ok.
- [ ] **Step 5: Commit** `feat(locks): fixed-rent units on the income and deductions steps`.

### Task 5: Notice on a reservation edit in an income-locked month

**Files:**
- Modify:
  - `functions/_lib/lockGuards.ts`: `incomeNotice`;
  - the routes:
    - `functions/api/reservations/[id]/dates.ts`;
    - `functions/api/reservations/[id]/cancel.ts`;
    - `functions/api/reservations/[id].ts` (PATCH);
    - `functions/api/reservations/index.ts` (POST);
    - `functions/api/reservations/[id]/duplicate.ts`;
    - `functions/api/reservations/[id]/payments.ts` (POST);
    - `functions/api/reservations/[id]/payments/[paymentId].ts` (DELETE);
  - the screens: `src/components/booking/BookingDrawer.tsx` (dates, status, cancel, duplicate, payments), `src/pages/CalendarPage.tsx` (drag), `src/pages/BookingsPage.tsx` (new).
- Test: checks N1–N4 in `owner-close-late.mjs`.

**Interfaces:**
- Consumes:
  - `incomeNoticeText` (Task 1);
  - `stayMonths` from `functions/_lib/airbnbConfirm.ts`;
  - `closedMonthsFor`, `lockedMonthsFor`, `unitLabel`.
- Produces:
  - `incomeNotice(env: Env, unitId: string, months: string[]): Promise<string | null>`.
    - It returns null when none of `months` is income-locked for the unit.
    - With exactly one locked month, the target is `openMonthAfter(month, closed o2)`; otherwise the target is null.
  - Each route above adds `notice: string | null` to its JSON.

Which months each route passes:
- **dates:** the old and the new stay;
- **new and duplicate:** the new stay;
- **cancel, and PATCH:** the stay, but only when the move takes it into or out of `confirmed`, `checked_in` or `checked_out`;
- **payments, both ways:** the stay.

Screens: when `notice` is set, a toast `{ tone: 'info', title: 'Income is locked', body: notice }`, next to the action's own toast.

Checks. They run on the check's third unit, `Late Court L-03`, with only its October income locked, so the earlier checks' November O2 lock does not change the target.
- **N1.** October income locked. Move an October stay's checkout by a day. Expected notice: `October 2026 income is locked for Late Court L-03. The difference goes to November 2026.`
- **N2.** A stay from 30 Oct to 2 Nov, with only October locked. The notice names only October.
- **N3.** A December stay moved within December: `notice` is null.
- **N4.** A new October reservation, and cancelling it, both carry the notice. Recording a payment on a direct October booking with no booking value carries it too.

- [ ] **Step 1: Write N1–N4.**
- [ ] **Step 2: Run** the check. Expected: N1, N2 and N4 FAIL (no `notice`).
- [ ] **Step 3: Implement** the helper, the routes and the screens.
- [ ] **Step 4: Run** the check, `reservations.mjs` and any check that posts reservations, plus `npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(locks): tell the person editing a reservation in an income-locked month`.

### Task 6: Lock powers are given one by one

**Files:**
- Modify:
  - `functions/_lib/access.ts`: `Area.ownGrant`, set on the four powers; `resolveFor` skips the two category-baseline steps for them;
  - `functions/_lib/accessRules.ts`: `categoryList` passes `ownGrant`;
  - `src/lib/types.ts`: `ownGrant?: boolean` on the category's areas;
  - `src/lib/roleGrid.ts`: `resolveRoleLevels` skips group levels for own-grant areas; new `bulkKeysOf(category)`;
  - `src/components/permissions/RoleGrid.tsx`:
    - the group row's tier boxes and difference mark use `bulkKeysOf`;
    - an own-grant area row shows a muted `Set on its own` tag, with the title `The Finance ticks above do not change this.`
- Test:
  - `src/lib/access.test.mjs`, `src/lib/roleGrid.test.mjs`;
  - check P1 in `owner-close-late.mjs`.

**Interfaces:**
- Produces:
  - `Area.ownGrant?: boolean`;
  - `bulkKeysOf(category: { areas: { key: string; ownGrant?: boolean }[] }): string[]`.

Tests:
- **access.test.mjs.** A staff person with department rule `group:Finance = edit` and no area rules:
  - `lockIncome` resolves `none`;
  - `ownerClose` resolves `edit`.
  - With an area rule `lockIncome = edit` at position level, it resolves `edit`.
- **roleGrid.test.mjs.**
  - The same pair for `resolveRoleLevels`.
  - `bulkKeysOf` of a Finance category leaves the four out.
  - `raiseTo(levels, bulkKeysOf(cat), 'edit')` leaves `lockIncome` at `none`.
- **P1** (API). A new department with `group:Finance = edit`, and a user in it:
  - `POST /api/owner-close/lock` with `{}` gives 403 "You can't lock any step";
  - after a user rule `lockIncome = edit` (and the 11 s rules cache), it gives 422.

- [ ] **Step 1: Write the failing tests.**
- [ ] **Step 2: Run** `node --test src/lib/access.test.mjs src/lib/roleGrid.test.mjs` and P1. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unit tests, P1, `role-access.mjs` and `rbac-matrix` locally.
  - Expected: pass. If a matrix row for `/api/owner-close/lock` changes because CI's seeded Finance persona held the powers only through the baseline, update `rbac-matrix.expected.json` (CRLF) and add a ledger ruling.
- [ ] **Step 5: Check in the browser:** Users and roles, the Finance group expanded, the tag shown, ticking Finance Edit leaves the four unticked.
- [ ] **Step 6: Commit** `feat(access): lock and unlock powers are given one by one`.

### Task 7: SOP and wrap-up

**Files:**
- Modify: `docs/finance/FINANCE-SOP.md` §9.1. Add a Chinese "第二部分（2b）已做" section:
  - the company share and where it shows, with the RM 100 / 75 / 25 example;
  - fixed rent on the two steps (no contract is GRR today; the Package C contracts are LT and already on the steps);
  - the reservation notice;
  - the four powers given one by one.
  - Then trim 还没做 to part 3.
- This plan: an "As built" section.

- [ ] **Step 1: Write the SOP section and As built.**
- [ ] **Step 2: Run the whole suite** in CI order on a fresh PGlite, plus `npm test`, `npm run check` and `npx tsc -b`.
  - Expected: everything as after 2a.
  - The role-access, unit-costs and demo-mode local failures (ops-staff user) are the known ones.
  - `npm test`: the 3 known failures only.
- [ ] **Step 3: Commit** `docs(locks): part 2b in the SOP and the plan`.

## Not in this plan

- **Part 3:** Final gating, Unlock final, and on the Overall owner report the Locks column and the Agent / Company split.
- **Dashboard › management fees** (the operator share) does not take the company rows: it is not the company's result.
- **Guest total and Service fees on Finance › Unit P&L** for a locked month still read today's reservations, so the fees line can move while Company keeps does not. This was already so after part 1, and is left alone.
- **The 2a deferred minors** stay deferred. The company split follows M6, the misc attribution when income is locked after deductions, exactly as the owner's does.

## As built (12 Nov 2026)

**Built.**
- **Choice A.** Migration 0304 adds `company_late_changes`. `syncLate` keeps the company's share of each lock's late difference in it:
  - the share is `companyFigure`, split by `splitLate`;
  - it goes on the owner adjustment's month, in the same transaction;
  - a row on a month since O2-locked or final stays.
- **Unlock** withdraws what can still move and carries back what is settled ("Already counted in …").
- **Company views.** `companyLateFor` feeds:
  - the Overall owner report (a Late changes column and drawer lines, in Gain / Loss);
  - the Yearly report (in The Conts, with its own block);
  - Finance › Unit P&L (a line, a table column, in Company keeps);
  - the unit's Financials (a row, in The Conts' result).
  - Each shows only when there is one. A unit-month with only a late row still has its row.
- **Reservation notice.** Dates (drawer and calendar), new reservations, status moves into or out of income, and payments on a booking with no host payout answer with `notice` when a touched month's income is locked. The screens show the toast "Income is locked".
- **Lock powers given one by one.** `Area.ownGrant` is set on Lock income, Lock deductions, Lock O2 and Unlock a step:
  - `resolveFor` and `resolveRoleLevels` skip category baselines for them;
  - the role grid's group ticks leave them alone (`bulkKeysOf`);
  - their rows show "Set on its own".
- **Check.** `owner-close-late.mjs` (C1–C6, R1–R5, N1–N4, P1), in CI after owner-close-steps.

**Not built (ruling).** Task 4, fixed-rent units on Income and Deductions. GRR was retired on 4 Nov 2026 (migration 0206):
- the database refuses it on a contract and on a unit;
- production has no GRR unit.
- Task 1's fixed-rent rule and wording were taken back out.

**Rulings** are in the ledger and the PR. In short:
- the 2a check clears the company rows;
- `late` is optional (0 when absent);
- `lateLabel` names a late row by its month and step;
- the drawer's bar shows the month's own split;
- a late column is added to the per-unit table;
- fixed rent was dropped;
- a duplicate gives no notice (it is saved pending);
- status-move notices come from `applyMove`;
- payment notices come only on a booking with no host payout;
- the group reset leaves the one-by-one powers alone.

**Known, not changed.**
- `reservations.mjs`, `booking-lifecycle.mjs` and `booking-payments.mjs` fail locally at their first step: the fixture's phone fails validation, and their own sign-in gets 401. They are not in CI.
- `rbac-matrix` runs only in CI.
