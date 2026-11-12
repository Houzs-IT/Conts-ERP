# Unit report click-to-lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close a month on the Unit report by clicking amounts: six lock categories (Revenue, Cleaning, Utilities, Add. ded., Misc, O2) plus Final, the same locks on the work pages, and no separate Statement close page.

**Architecture:** The stored stage list grows from `income | deductions | o2` to `income | cleaning | utilities | additional | misc | o2`; the engine keeps each cost category's frozen costs (and the misc charge) under its own lock, and the late update turns locked stages live one at a time to split a late difference between them. One lock API (category + many units or `all`, lock or unlock, no reason for unlock) serves the Unit report and the work pages; the Unit report payload carries each unit's locks, steps, hover hints and readiness without a second month load.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), Postgres (schema `pos`, migrations in `migrations-pg/`), React + Tailwind (`src/`), node --test (`src/lib/*.test.mjs`), API checks (`scripts/api-checks/*.mjs` on local PGlite, run in CI).

**Spec:** `docs/superpowers/specs/2026-11-13-unit-report-click-locks-design.md`

## Global Constraints

- Product text in British English; no CJK in `src/` or `functions/`. Chat with chew in Chinese.
- Screen names of the categories: "Revenue", "Cleaning", "Utilities", "Add. ded.", "Misc", "O2"; in sentences: "revenue", "cleaning", "utilities", "other deductions", "misc", "O2". Owner-facing late-change descriptions keep the word "income" for the Revenue lock.
- Locks start at `LOCK_FROM = '2026-10'`; a month that has not ended (MYT) cannot be locked (`lockMonthProblem`).
- Locked colour tokens (new, light / dark): `--color-lock-bg` #DDF1EF / #16302E, `--color-lock-line` #B9DFDA / #24504B, `--color-lock` #1F8A8A / #5FC4BC (icon), `--color-lock-ink` #0B4F4A / #BFEAE5 (text on the fill). Never raw hex in components.
- Powers (unchanged areas): Lock income → `income`; Lock deductions → `cleaning`, `utilities`, `additional`, `misc`; Lock O2 → `o2`; Unlock a step → every unlock; Make final / Unlock final as today.
- Small unlocks and Unlock all take no reason; Unlock final (one or all) requires a reason of 1–500 characters.
- Migration number 0323 (0322 is reserved for the agent % fill). Production changes only through `migrate-production.yml`, dry run first.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never commit `exports/` or `tsconfig.tsbuildinfo`.

## Review Focus

1. A cost whose category is edited from a locked category to an open one (or back) in a locked month is counted once in the statement and once in the live run: no double count, no late difference when only the category changed.
2. Unlock all on a month where some owners are final leaves those owners' units locked and names them; the rest unlock.
3. Lock all on Revenue with no Airbnb file for the month locks every unit (nothing is unconfirmed); with lines to confirm it skips exactly those units.
4. Make final on an owner with no statement yet, or with a draft older than the latest lock, generates the statement first and then makes it final.
5. A unit at zero for a category (no utility bill yet, no misc on its contract, no cleaning) can be locked, and once all six are locked its owner can be made final.

---

### Task 1: The rules — six stages

**Files:**
- Modify: `functions/_lib/stageLocks.ts`
- Test: `src/lib/stageLocks.test.mjs`

**Interfaces:**
- Produces:
  - `type Stage = 'income' | 'cleaning' | 'utilities' | 'additional' | 'misc' | 'o2'`; `STAGES: Stage[]` in that order.
  - `COST_STAGES = ['cleaning', 'utilities', 'additional'] as const`; `type CostStage`.
  - `LATE_STAGES: Stage[] = ['income', 'cleaning', 'utilities', 'additional', 'misc']` (the late update's order).
  - `costStageOf(category: string, description: string | null): CostStage` — the same split as `classifyCost` (`cleaning`/`housekeeping` → cleaning; `electricity`/`water`/`internet`/`sewerage`, or `utilities` with /indah|sewer|iwk/i in the description → utilities; anything else → additional).
  - `STAGE_LABEL: Record<Stage, string>` (screen) and `stageName(stage): string` (sentences: "other deductions" for additional).
  - `lateShares(statement: number, runs: number[]): number[]` — `runs[k]` is the payout with `LATE_STAGES[0..k]` live; share k = `runs[k] - (k ? runs[k-1] : statement)`.
  - `lateText(stage: Stage, unitLabel, label)`; `lateLabel(description)` reads every stage and the retired 'deductions' wording.
  - `lockedText`, `refusedText`, `rolledText(unitLabel, fromLabel, toLabel, why, stage: CostStage)`, `editedText(unitLabel, label, stage: CostStage)` per stage.
  - `stageHints`: `cleaningChecks({ checkouts, cleaning })`, `utilitiesChecks({ utilities, contractEnd, monthEnd })` replacing `deductionChecks`; `o2Checks` unchanged.
  - `finalWaiting` / `waitingText` over six stages, naming them by `STAGE_LABEL` ("Waiting: Cleaning, Misc and O2"; "Waiting: B-16-05 (B) Misc").
  - `lockable(stage, basis)`: O2 always; every other stage only on a share.

- [ ] **Step 1: Write the failing tests** in `src/lib/stageLocks.test.mjs` (replace the deductions-era ones):
  - `costStageOf('cleaning', null) === 'cleaning'`, `('housekeeping','') === 'cleaning'`, `('sewerage','') === 'utilities'`, `('utilities','Indah Water Oct') === 'utilities'`, `('utilities','Lift repair') === 'additional'`, `('maintenance','Aircon') === 'additional'`.
  - `lateShares(100000, [100500, 100500, 99900, 99900, 99800])` deep-equals `[500, 0, -600, 0, -100]`.
  - `lateLabel(lateText('additional', 'Vista 22-04', 'October 2026')) === 'October 2026 other deductions'`; the old text `'Late change to Vista 22-04 deductions for October 2026 (deductions locked)'` still reads `'October 2026 deductions'`.
  - `waitingText(finalWaiting([{ unitId: 'u', label: 'A-1', steps: STAGES, locked: ['income','cleaning','utilities','additional'] }]), 1) === 'Waiting: Misc and O2'`.
  - `refusedText('utilities', 'Vista 22-04', 'October 2026')` contains `'October 2026 utilities are locked for Vista 22-04.'`.
  - `lockable('misc', 'share') && !lockable('cleaning', 'none') && lockable('o2', 'none')`.
- [ ] **Step 2: Run** `node --test src/lib/stageLocks.test.mjs`. Expected: FAIL (`costStageOf` and `lateShares` not exported).
- [ ] **Step 3: Implement** the Produces list in `functions/_lib/stageLocks.ts`; delete `splitLate`, `LateRun` and `deductionChecks`.
- [ ] **Step 4: Run** `node --test src/lib/stageLocks.test.mjs`. Expected: PASS. Then `npx tsc -b` — expected to fail only in the files later tasks change; list them in the ledger.
- [ ] **Step 5: Commit** `feat(locks): six lock stages and their rules`.

### Task 2: The engine — a lock per cost category and for misc

**Files:**
- Modify: `functions/_lib/ownerStatement.ts` (FrozenDeductions → per category; `loadInputs`; `computeUnitMonth`; freeze helpers; drop `withoutMisc`)
- Test: `scripts/api-checks/owner-close-steps.mjs` (moved to the new stages)

**Interfaces:**
- Consumes: `costStageOf`, `CostStage`, `Stage` (Task 1).
- Produces:
  - `interface FrozenCosts { costs: CostRow[] }`, `interface FrozenMisc { misc: { amount: number; exact: number; occupancy: number } }`.
  - `interface KeptDeductions { cleaning?: FrozenCosts & { lockId: string }; utilities?: …; additional?: …; misc?: FrozenMisc & { lockId: string } }`; `Inputs.deductions?: Map<string, KeptDeductions>` keyed `${unitId}|${month}`.
  - `freezeCosts(m: UnitMonth, costs: CostRow[], stage: CostStage): FrozenCosts`; `freezeMisc(m: UnitMonth, costs: CostRow[]): FrozenMisc` (exact = `m.deductionsExact` less the unit-month's cost total, as today).
  - `unfreeze(inputs: Inputs, stages: Stage[]): Inputs` — the inputs with those stages live (income: drops `frozen`; a cost stage or misc: drops that key from each `KeptDeductions`).
  - `computeUnitMonth(..., kept?: KeptDeductions)`: per cost stage, the kept costs when locked, else the live costs of that stage **minus any cost id kept by another locked stage of the same unit-month** (Review Focus 1); misc kept when locked, else from occupancy.
- `loadInputs` reads lock rows of stages `cleaning`/`utilities`/`additional` (costs) and `misc`; a `deductions` row never exists after 0323 (Task 3 refuses to migrate one).

- [ ] **Step 1: Move `owner-close-steps.mjs` to the new stages (failing)**: wherever it locks `deductions`, lock `cleaning`, `utilities`, `additional` and `misc` separately (through `POST /api/owner-close/lock`), and add:
  - `utilities locked, cleaning open: a new cleaning charge stays in October; a new electricity bill rolls to November (late bill)`.
  - `misc locked alone: a reservation added later leaves October's misc as locked`.
  - `category edited from cleaning (locked) to additional (open) in a locked October: the statement still counts it once, under cleaning` (Review Focus 1: the unit's October deductions total is unchanged and the late update posts nothing).
- [ ] **Step 2: Run** the check (`DB_URL=… API_BASE=… node scripts/api-checks/owner-close-steps.mjs`). Expected: FAIL — the API refuses the new stages.
- [ ] **Step 3: Implement** the Produces list in `ownerStatement.ts`.
- [ ] **Step 4: Run** after Tasks 3–6 land (the check needs the migration and the API); record the RED here, GREEN in Task 6.
- [ ] **Step 5: Commit** `feat(locks): engine keeps each cost category and misc under its own lock`.

### Task 3: Migration 0323

**Files:**
- Create: `migrations-pg/0323_owner_report_lock_categories.sql`

**Interfaces:**
- Produces: `owner_report_locks.stage` CHECK `('income','cleaning','utilities','additional','misc','o2')`; `expenses_deduct_month()` checking the cost's own stage.

- [ ] **Step 1: Write the migration** (header in the house style: what, APPLY, REVERSAL):
  - `set local search_path = pos; set local lock_timeout = '5s'; select demo.drop_views();`
  - Refuse while any `deductions` lock exists: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM owner_report_locks WHERE stage = 'deductions') THEN RAISE EXCEPTION 'Unlock the deductions locks before 0323 (owner statement close).'; END IF; END $$;` (ledger ruling: production had none on 13 Nov; converting them would need their posted late lines re-pointed).
  - Swap the stage CHECK (look up its name with `SELECT conname FROM pg_constraint WHERE conrelid = 'pos.owner_report_locks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%stage%'` in a `DO` block, drop it, add `owner_report_locks_stage_check`).
  - `CREATE OR REPLACE FUNCTION expenses_deduct_month()`: 0303's body with the stage worked out as `CASE WHEN NEW.category IN ('cleaning','housekeeping') THEN 'cleaning' WHEN NEW.category IN ('electricity','water','internet','sewerage') OR (NEW.category = 'utilities' AND coalesce(NEW.description,'') ~* 'indah|sewer|iwk') THEN 'utilities' ELSE 'additional' END` and both lock lookups (`EXISTS … l.stage = <that>`) using it; owner `pos_app`.
  - `select demo.sync();`
- [ ] **Step 2: Run it** on the local PGlite (restart `scripts/dev-pglite.mjs` on a fresh data dir) and check `SELECT pg_get_constraintdef(oid) …` lists the six stages. Expected: the server starts, migration applied.
- [ ] **Step 3: Commit** `feat(locks): migration 0323, six lock stages and the per-category late bill`.

### Task 4: Locking, unlocking and the late update

**Files:**
- Modify: `functions/_lib/ownerLocks.ts`
- Create: `functions/_lib/lockReadiness.ts`
- Test: `scripts/api-checks/owner-close-late.mjs`, `scripts/api-checks/owner-close.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `unconfirmedRevenue(env, month): Promise<{ byUnit: Map<string, number>; files: number }>` in `lockReadiness.ts` — the month's own reconciliation lines still to confirm, by the units of their reservation (the logic now in `api/owner-close/index.ts` lines 52–60); a line with no reservation blocks nothing; `files` = Airbnb files uploaded for the month (0 → nothing blocks, the screens say so). Routes pass `byUnit` into `lockStage` (pre-flight ruling).
  - `monthSteps(env, month, ctx?)` (renames `closeSteps`; `ctx` lets the Unit report pass its already-computed `inputs`/`dated` so the month is loaded once): `{ inputs, dated, locks, finals, steps: Record<Stage, string[]>, counts: Record<Stage, { locked; total }> }`. Revenue/Cleaning/Utilities/Add. ded./Misc list share units with activity; O2 as today.
  - `lockStage(env, who, month, stage, unitIds: string[] | 'all')` → `{ locked, already, notLockable, final, notReady: { unitId: string; reason: string }[], unknown }`; `'all'` = the stage's step units; Revenue refuses units with unconfirmed lines (`notReady`, reason "2 Airbnb reservations still to confirm.").
  - `unlockStages(env, who, month, stage, unitIds: string[] | 'all', reason: string | null)` → `{ unlocked: string[]; notLocked: string[]; refused: { unitId: string; problem: string }[]; regenerate: string[] }` — `unlockStage` per unit, each in its own transaction; a final owner's unit is refused with "Unlock the final first."
  - `syncLate` over `LATE_STAGES`: one statement run plus one cumulative run per stage locked anywhere in the batch (`unfreeze(inputs, LATE_STAGES.slice(0, k + 1))`); each lock's diff and company diff from `lateShares`.
  - `finalReadiness(env, month, ctx?)` over six stages.
- [ ] **Step 1: Failing checks**: in `owner-close-late.mjs`, lock revenue + utilities + misc on a unit, then add a reservation and raise an electricity bill: expect three late lines (revenue, utilities, misc), each its own `stage-lock:<id>` reference, adding up to the live difference; in `owner-close.mjs`, `Lock all` (`unitIds: 'all'`) on revenue skips the unit with a line to confirm (`notReady`), and `unlock` with `unitIds: 'all'` and no reason unlocks every unit not final and names the final one in `refused` (Review Focus 2, 3).
- [ ] **Step 2: Run** them. Expected: FAIL (422 on the new body).
- [ ] **Step 3: Implement** the Produces list.
- [ ] **Step 4: Run** after Task 6. Expected: PASS.
- [ ] **Step 5: Commit** `feat(locks): lock and unlock many units per category; late update per category`.

### Task 5: Cost guards per category

**Files:**
- Modify: `functions/_lib/lockGuards.ts`, `functions/api/expenses/index.ts`, `functions/api/expenses/[id].ts`, `functions/api/expenses/utilities.ts`, `functions/_lib/utilityScan.ts`, `functions/api/maintenance/issues/[id]/complete.ts`
- Test: `scripts/api-checks/owner-close-steps.mjs` (from Task 2), `scripts/api-checks/utility-bills.mjs`

**Interfaces:**
- Produces: `costLocked(env, unitId, month, stage: CostStage)`; `costNotice(env, c: { unitId; incurredOn; deductMonth; category; description })`; `editNotice(env, unitId, deductMonth, stage)`; `costLockProblem(env, unitId, deductMonth, stage)`; every caller passes `costStageOf(cost.category, cost.description)`; Utility bills and the bill scan ask `closedMonthsFor(…, 'utilities')`.
- [ ] **Step 1: Failing checks**: deleting a cleaning cost in a cleaning-locked month is refused ("October 2026 cleaning is locked for …"); deleting an additional cost in the same month while only cleaning is locked succeeds; replacing a utility bill in a utilities-locked month is refused as today.
- [ ] **Step 2–4:** run (FAIL), implement, run after Task 6 (PASS).
- [ ] **Step 5: Commit** `feat(locks): cost guards follow the cost's own category`.

### Task 6: The lock API

**Files:**
- Modify: `functions/api/owner-close/lock.ts`, `functions/api/owner-close/unlock.ts`
- Create: `functions/api/owner-close/summary.ts`
- Delete: `functions/api/owner-close/index.ts`
- Modify: `functions/_lib/access.ts` (route rule for `summary`), `scripts/rbac-matrix*` rows, `src/lib/access.test.mjs`

**Interfaces:**
- `POST /api/owner-close/lock { month, stage, unitIds: string[] | 'all' }` → `{ locked, already, notLockable, final, notReady }` (201 when any locked).
- `POST /api/owner-close/unlock { month, stage, unitIds: string[] | 'all', reason?: string }` → `{ unlocked, notLocked, refused, regenerate }`; reason optional, ≤ 500.
- Power per stage: `{ income: 'lockIncome', cleaning|utilities|additional|misc: 'lockDeductions', o2: 'lockO2' }`; unlock: `unlockStep`.
- `GET /api/owner-close/summary?month=` (any lock power, Unlock a step, or session.manage) → `{ month, lockProblem: string | null, airbnbFiles: number, counts: Record<Stage, { locked; total }>, notReady: { unitId; label; reason }[], may: { lock: Record<Stage, boolean>; unlock: boolean } }` — for the work pages' lock bars.
- Retire the `ownerClose` access area (its page and GET are gone): remove it from `access.ts`, the rbac matrix and `access.test.mjs`.
- [ ] **Step 1:** run the checks from Tasks 2, 4 and 5. Expected: FAIL.
- [ ] **Step 2: Implement** the routes and the rbac rows.
- [ ] **Step 3: Run** `owner-close`, `owner-close-steps`, `owner-close-late`, `owner-close-final`, `utility-bills`, `airbnb-recon`, `rbac` checks and `npm test`. Expected: PASS (owner-close-final updated in Task 7).
- [ ] **Step 4: Commit** `feat(locks): one lock API for a category and many units; work-page summary`.

### Task 7: Unit report data and Final

**Files:**
- Modify: `functions/api/portfolio/owner-report.ts`, `functions/api/statements/finalise.ts` (waiting wording), `scripts/api-checks/owner-close-final.mjs`
- Create: `scripts/api-checks/owner-report-locks.mjs`

**Interfaces:**
- Row additions: `steps: Stage[]`, `locks: Partial<Record<Stage, { by: string; at: string }>>`, `toConfirm: number`, `hints: Partial<Record<Stage, string>>` (Revenue "12 reservations, 30 nights"; Cleaning "4 cleans" plus `cleaningChecks`; Utilities the bills by name plus `utilitiesChecks`; Add. ded. the cost descriptions; Misc "RM 100 at 96.77% occupancy" or "No misc on this contract"; O2 credits/charges plus `o2Checks`).
- Payload additions: `counts: Record<Stage, { locked; total }>`, `may: { lock: Record<Stage, boolean>; unlock: boolean; makeFinal: boolean; unlockFinal: boolean; generate: boolean }`.
- Readiness from `monthSteps(env, month, { inputs, dated })` and `finalReadiness(env, month, ctx)` — no second `loadInputs`.
- From `LOCK_FROM`, the month is worked out in `'open'` mode with each owner's statement id (a final owner's adjustments restricted to the ones on that statement), so O2 and Owner payout show what the statement takes — the set the O2 lock keeps (spec, builder check answers). Earlier months stay `'dated'`.
- Payload: `airbnbFiles: number` (0 → the screen says no Airbnb file is uploaded for the month yet).
- finalise refusal text: "Lock every category on the Unit report before marking it final."
- [ ] **Step 1: Failing check** `owner-report-locks.mjs`: payload of a fixture month carries the six `steps`, a lock's `by`/`at`, `toConfirm` 2 on the unit with recon lines, `counts.cleaning.locked` after a cleaning lock, `may.lock.misc` for management; an open owner adjustment dated in September shows in October's O2 (and the O2 lock keeps it), and one attached to a final September statement does not.
- [ ] **Step 2:** `owner-close-final.mjs`: every lock call moves to the six stages; Make final waits for Misc when only five are locked ("Waiting: Misc"); a unit with no utility bill and no misc on its contract (both RM 0) locks all six and its owner is made final (Review Focus 5).
- [ ] **Step 3–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(locks): Unit report payload carries locks, hints and readiness`.

### Task 8: Unit report screen

**Files:**
- Modify: `src/pages/OwnerOverallReportPage.tsx`, `src/styles/tokens.css`, `src/styles/theme-dark.css`
- Create: `src/pages/ownerReportLocks.tsx` (LockCell, WholeColumnRow cells, FinalCell, the actions that call the API)

**Interfaces:**
- Column → stage: `revenue → income`; `cleaning`; `electricity|water|internet|sewerage|utilities → utilities`; `additional`; `misc`; `o2`.
- Click on a lockable cell: `stopPropagation`; lock or unlock that unit's stage (`unitIds: [id]`), patch the row's `locks` locally from the response, then refresh the report in the background; refused → toast with the reason; no power → toast naming the permission; final owner → toast "Unlock the final first."; `toConfirm > 0` on Revenue → amber cell, toast with a button to the Airbnb reconciliation tab.
- Whole column row (third header row, `showClose` months only): per stage "Lock all" / "Unlock all" (`unitIds: 'all'`), one pair over the four utility columns at level 2, under "Utilities" at level 1; toast summarises locked / skipped (with names).
- Final column replaces Locks + Final: first row of the owner — final: teal cell "Final · by · date" (click → Unlock final with a reason, as today); ready: "Make final" (POST `/statements/generate { period, ownerIds: [owner] }`, then POST `/statements/finalise` with the new statement id); waiting: "Waiting: …"; other rows: "Same owner" (teal when final). Whole column: Lock all (generate for every ready owner in one call, then finalise their statements) and Unlock all (one reason, `unlock-final` per final statement, toast names any refused).
- Phone cards: "N of 6 locked · <final text>" in place of the chips. Export: a column per stage ("Locked" / "Open") and Final.
- [ ] **Step 1:** build; `npx tsc -b`; `npm run build`. Expected: clean.
- [ ] **Step 2: Browser check** on the local copy (management test cookie): click Revenue on a unit → teal with the lock on the left; click again → open; Lock all on Cleaning; the amber Revenue cell refuses; Make final on a ready owner; Unlock final asks why; dark theme readable; 375px phone cards. Ledger ruling: no React test harness, so the screen is checked in the browser; its server paths are covered by Tasks 4–7.
- [ ] **Step 3: Commit** `feat(locks): click an amount on the Unit report to lock it`.

### Task 9: Work pages, menu and the close page

**Files:**
- Create: `src/components/LockBar.tsx`
- Modify: `src/pages/finance/AirbnbReconPage.tsx` (LockBar for `income`, replacing the "Owner statement close" button), `src/pages/ExpensesPage.tsx` (utilities mode: LockBar for `utilities` when one month is shown), `src/pages/DeductionsPage.tsx` (LockBars for `cleaning`, `additional`, `misc` and `o2`), `src/lib/navigation.ts` (Airbnb reconciliation as a Unit report tab after Monthly; Statement close removed from Owners), `src/App.tsx` (`/owners/close` → `/portfolio/owner-report?month=…`)
- Delete: `src/pages/owners/OwnerReportClosePage.tsx`

**Interfaces:**
- `LockBar({ month, stage, onChange? })`: reads `GET /api/owner-close/summary`, shows "Revenue · 118 of 130 units locked" with a teal bar, the not-ready units, "Lock all" and "Unlock all" (hidden without the power, with the lock problem as a note when the month cannot be locked).
- [ ] **Step 1:** implement; `npx tsc -b`; `npm run build`; navigation test in `src/lib/*.test.mjs` if one covers the menu (else ledger note).
- [ ] **Step 2: Browser check**: the three bars lock and unlock and the Unit report shows the same state after reload; the menu shows Airbnb reconciliation under Unit report; `/owners/close?month=2026-10` lands on the Unit report for October.
- [ ] **Step 3: Commit** `feat(locks): lock bars on the work pages; Airbnb reconciliation under the Unit report; Statement close retired`.

### Task 10: SOP, CI and the full run

**Files:**
- Modify: `docs/finance/FINANCE-SOP.md` §9.1 (Chinese: the Unit report way, six categories, click and Lock all, Final as a lock, work-page bars, unconfirmed blocks, blank/zero does not), `.github/workflows/ci.yml` (add `owner-report-locks`), the plan's As built section.
- [ ] **Step 1:** run every check this plan touched plus `npm test`, `npm run check`, `npx tsc -b`, `npm run build` on a fresh local database. Expected: all pass except the known `statementPdf` module-resolution failure that is also on main.
- [ ] **Step 2: Commit** `docs(finance): SOP 9.1 for the Unit report locks; CI step`.
