# Owner report locks, part 2a (Deductions and O2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Owner statement close, chew and the people she gives the powers to can lock a month's **deductions** and its **O2** unit by unit, the same way they lock income. A locked figure never changes. A cost or owner adjustment that arrives later lands in the next open month, and the person who adds it is told so.

**Architecture:**
- **Store.** Same table, `owner_report_locks` (migration 0302).
  - A deductions lock keeps the unit-month's owner-charged costs and its misc charge.
  - An O2 lock keeps the owner adjustments that the month's statement takes for the unit.
- **Engine.** `ownerStatement.ts` works a locked unit-month out from what its locks kept:
  - deductions: the kept costs and misc;
  - O2: a statement being generated takes the kept adjustments and nothing else for that unit. Anything else still open rolls to the next statement.
  - Statements, reports and dashboards therefore all show the locked figures.
- **New costs.** They never land in a locked month. The database trigger that sets `expenses.deduct_month` (migration 0174) moves a cost dated in a deductions-locked month to the next month that is neither locked nor final. One place covers all 14 paths that write costs, including a lock taken between a route's check and its insert.
- **New owner adjustments.** The routes that create them date them past O2-locked months.
- **Late differences.** The part 1 sync becomes one sync for income and deductions locks.
  - Each lock keeps one owner adjustment per target month for its share of the difference between the locked and the live figures.
  - The order is income first, then deductions. That way the misc change caused by a reservation goes with income (spec call 11).
  - Targets skip O2-locked months.

**Tech Stack:** as part 1:
- Cloudflare Pages Functions (TypeScript), Postgres schema `pos`;
- React with the project's `DataTable`, `useConfirm` and toast;
- `node --test src/lib/*.test.mjs` for pure rules;
- `scripts/api-checks/*.mjs` against local PGlite with `wrangler pages dev` for behaviour.

**Spec:** `docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md` (approved by chew, 11 Nov 2026). Part 1 plan and as-built notes: `docs/superpowers/plans/2026-11-11-owner-report-locks-part1-income.md`.

**Where this sits.** Part 2 ships in two pieces:
- **2a, this plan:**
  - the Deductions and O2 locks, with their guards and notices;
  - the misc freeze;
  - the two steps on Owner statement close.
- **2b, next:**
  - the company's share of a late change in the unit P&L, the yearly report and the portfolio (chew's choice A, FINANCE-SOP §9.1);
  - fixed-rent (GRR) units on the Income and Deductions steps. Their locks freeze only company figures, so they wait for A;
  - the notice on a manual reservation edit in an income-locked month.
- **Part 3** is unchanged: Final gating, Unlock final, the Locks column, and the Agent/Company split.

## Global Constraints

Every constraint from part 1 holds. In particular:
- English (British) copy only, with no CJK in `src/`;
- say "owner adjustments", "Owner statement", "reservations" and "building";
- no lock before `2026-10`, and none for a month that has not ended (Malaysia time);
- only ticked units are locked;
- every lock and unlock records who did it and when, and every unlock records a reason (1–500 characters, in `audit_log`);
- migrations go through `migrate-production.yml` (dry run first) and only with chew's OK each time;
- production SQL through MCP is insert/update only, with no DROP or DELETE, even in comments;
- `rbac-matrix.expected.json` keeps CRLF;
- `tsc -b` is run on its own;
- toast tones are success, warning, critical, info and neutral.

New here:
- **Who is on each step:**
  - Income and Deductions: share contracts only (`basis === 'share'`, which includes long-term lets);
  - O2: every unit on the month's statement, master leases and fixed rents included.
- **Powers:**
  - Two new access areas, closed for every department by migration 0303:
    - `lockDeductions` ("Lock deductions");
    - `lockO2` ("Lock O2").
  - Unlocking any step is still `unlockStep`.
- **Final months keep today's rules:**
  - a cost on a final statement cannot be edited or deleted;
  - only utility bills roll past a final month;
  - other new costs dated in a final month are refused or skipped, as now.
  - Part 3 looks at this again once Final needs all three locks.
- **Copy:** every message about a locked month comes from the functions in Task 1. No route or screen writes its own wording.

## Review Focus

1. **A locked cost is moved:** to another month (its date edited) or to another unit, or it is no longer charged to the owner.
   - The locked month keeps its figure.
   - The sync posts that month's difference to the next open month.
   - The cost lands where it now belongs, past any locked month.
   - Overall the owner is charged once.
   - Tested in Task 3 (D13).
2. **Income and deductions both locked, then a reservation change that moves occupancy** on a unit with the misc charge.
   - The misc difference goes in the income lock's adjustment.
   - The deductions lock's adjustment stays as it was.
   - After income is unlocked, the misc difference moves to the deductions lock's adjustment.
   - Tested in Task 1 (`splitLate`) and Task 3 (D9, D10).
3. **An owner adjustment with no unit, for an owner whose first unit's O2 is locked.**
   - It is dated into the next open month.
   - Once kept by a lock it never counts twice, even if another unit becomes the owner's first.
   - Tested in Task 3 (O6).
4. **A late difference whose next month is O2-locked, or a difference already posted on a month that is O2-locked afterwards.**
   - The new difference goes to the month after.
   - The one already posted stays where it is.
   - Tested in Task 3 (O7).
5. **A new cost on a deductions-locked month whose next month is final.** It rolls past the final month too. Tested in Task 3 (D12).

---

### Task 1: Pure rules

**Files:**
- Modify: `functions/_lib/stageLocks.ts`
- Test: `src/lib/stageLocks.test.mjs`

**Interfaces:**
- Produces:
  - `export const lockable = (stage: Stage, basis: string): boolean`. Income and deductions: `basis === 'share'`. O2: always true. `incomeLockable` becomes `b => lockable('income', b)`.
  - `export function lateText(stage: 'income' | 'deductions', unitLabel: string, label: string): string`.
    - Income: the part 1 text, unchanged.
    - Deductions: `Late change to ${unitLabel} deductions for ${label} (deductions locked)`.
    - The stage is a new first parameter; update its one caller (`ownerLocks.ts`).
  - `export interface LateRun { statement: number; incomeLive?: number; live: number }`. These are a unit-month's `payoutBeforeAdjustments` worked out three ways:
    - `statement`: as the statement takes it, with every lock's figures;
    - `incomeLive`: live income, the locked costs, and misc worked out live. Only when income and deductions are both locked;
    - `live`: everything live.
  - `export function splitLate(r: LateRun, locked: { income: boolean; deductions: boolean }): { income?: number; deductions?: number }`:
    - both: income = `incomeLive − statement`, deductions = `live − incomeLive`;
    - income only: income = `live − statement`;
    - deductions only: deductions = `live − statement`;
    - neither: `{}`.
  - Copy, exact:
    - `lockedText(stage, unitLabel, label)` → `October 2026 deductions are locked for Vista 22-04.` and `October 2026 O2 is locked for Vista 22-04.` (Income: `October 2026 income is locked for …`.)
    - `rolledText(unitLabel, fromLabel, toLabel, why: 'locked' | 'final')`:
      - locked: `${lockedText('deductions', …)} This cost goes on the November 2026 statement.`
      - final: `The October 2026 statement is final for Vista 22-04. This cost goes on the November 2026 statement.`
    - `editedText(unitLabel, label)` → `${lockedText('deductions', …)} The October 2026 statement keeps the old amount; the difference goes to the next open month as an owner adjustment.`
    - `refusedText(stage, unitLabel, label)` → `${lockedText(stage, …)} Ask someone who can unlock a step to unlock ${stage === 'o2' ? 'it' : 'them'} first.`
    - `movedO2Text(unitLabel, fromLabel, toLabel)` → `${lockedText('o2', …)} This owner adjustment is dated November 2026.`
  - Check chips:
    - `deductionChecks(x: { checkouts: number; cleaning: number; utilities: number; contractEnd: string | null; monthEnd: string }): string[]`:
      - `9 check-outs, no cleaning charged` (and `1 check-out, …`) when `checkouts > 0 && cleaning === 0`;
      - `Contract ended 15 Oct: check the bills` when `contractEnd <= monthEnd && utilities > 0`.
    - `o2Checks(x: { held: number; repeats: number; prevMonth: string }): string[]`, where `prevMonth` is a month name such as `September`:
      - `Held debt RM 3,541.92 not released` when `held !== 0` (the absolute amount, 2 decimals, thousands separator);
      - `Repeats one from September` when `repeats === 1`, `Repeats 2 from September` for more.

- [ ] **Step 1: Write the failing tests**, added to `src/lib/stageLocks.test.mjs`:
  - `lockable`: `('income','share')` true, `('income','fixed_rent')` false, `('deductions','none')` false, `('o2','none')` true.
  - `splitLate` with statement 75000, incomeLive 82500, live 81000:
    - both → `{ income: 7500, deductions: -1500 }`;
    - income only (no incomeLive) → `{ income: 6000 }`;
    - deductions only → `{ deductions: 6000 }`;
    - neither → `{}`.
  - Every text above, exactly, with `Vista 22-04`, `October 2026` and `November 2026`.
  - `deductionChecks`:
    - `{ checkouts: 9, cleaning: 0, utilities: 0, contractEnd: null, monthEnd: '2026-10-31' }` → `['9 check-outs, no cleaning charged']`;
    - `{ checkouts: 1, cleaning: 6500, utilities: 31424, contractEnd: '2026-10-15', monthEnd: '2026-10-31' }` → `['Contract ended 15 Oct: check the bills']`.
  - `o2Checks({ held: -354192, repeats: 1, prevMonth: 'September' })` → `['Held debt RM 3,541.92 not released', 'Repeats one from September']`.
  - `openMonthAfter('2026-10', new Set(['2026-11']))` → `'2026-12'`.
- [ ] **Step 2: Run them and watch them fail.** Run: `node --test src/lib/stageLocks.test.mjs`. Expected: FAIL, the new functions are not exported.
- [ ] **Step 3: Implement them** in `stageLocks.ts`. The file keeps no imports, so node can load it.
- [ ] **Step 4: Run the tests and `npm test`.** Expected: the new tests pass. The only failures are the three already on main (categoryCatalog ×2, statementPdf).
- [ ] **Step 5: Commit**: `feat(locks): rules and copy for deductions and O2 locks`.

---

### Task 2: Migration 0303 — the two powers, and new costs skip locked months

**Files:**
- Create: `migrations-pg/0303_owner_report_locks_deductions_o2.sql`.
  - This is the next free number in `migrations-pg/`: main and every branch end at 0302 there.
  - `engine/backend/src/db/migrations-pg/0303_*` is the engine's own folder and does not count.
  - Re-check before merging.

**Interfaces:**
- Produces:
  - the areas `lockDeductions` and `lockO2`, set to `none` for every department (`updated_by` = 'migration 0303', `ON CONFLICT DO NOTHING`);
  - `expenses_deduct_month()`, which keeps everything 0174 does and adds the rule below.

- [ ] **Step 1: Write the migration.**
  - Header: like 0302's, with the spec, the plan and an APPLY line (only=0303, dry run first).
  - REVERSAL: re-create the 0174 function body. The access rules can stay.
  - Start with `set local search_path = pos; set local lock_timeout = '5s';`.
  - Wrap it in `select demo.drop_views();` … `select demo.sync();`, as 0302 does.
  - The trigger function: add `DECLARE m text; owner_of text;`, keep everything 0174 does first, then put this block before `RETURN NEW`:

```sql
  -- Owner statement close (0303): a month whose deductions are locked for the unit takes no new cost. It goes on the
  -- first later month that is neither locked for the unit nor final for its owner, as a late bill.
  IF NEW.charge_to = 'owner' AND NOT NEW.record_only AND NEW.deduct_month >= '2026-10'
     AND (TG_OP = 'INSERT' OR NEW.deduct_month IS DISTINCT FROM OLD.deduct_month OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
          OR NEW.charge_to IS DISTINCT FROM OLD.charge_to OR NEW.record_only IS DISTINCT FROM OLD.record_only)
     AND EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = 'deductions' AND l.month = NEW.deduct_month) THEN
    SELECT u.owner_id INTO owner_of FROM units u WHERE u.id = NEW.unit_id;
    m := NEW.deduct_month;
    LOOP
      m := to_char((m || '-01')::date + interval '1 month', 'YYYY-MM');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM owner_report_locks l WHERE l.unit_id = NEW.unit_id AND l.stage = 'deductions' AND l.month = m)
        AND NOT EXISTS (SELECT 1 FROM owner_statements s WHERE s.owner_id = owner_of AND s.period_start = m || '-01' AND s.state IN ('finalised','sent','paid'));
    END LOOP;
    NEW.deduct_month := m;
    NEW.rolled := true;
  END IF;
```

  An edit that changes only the amount, description or category leaves the month alone. The sync posts the difference (Task 5).
- [ ] **Step 2: Apply it to a fresh local database and probe it.**
  - Run: `PORT=55442 node scripts/dev-pglite.mjs` and wait for `ready:`.
  - Then, in one session:
    - insert a deductions lock row for a unit and 2026-10;
    - insert an owner-charged expense dated 2026-10-05;
    - read its `deduct_month` and `rolled`;
    - delete both rows.
  - Expected: `2026-11`, true. The two areas have one rule per department.
- [ ] **Step 3: Commit**: `feat(locks): Lock deductions and Lock O2 powers; new costs skip a locked month (migration 0303)`.

---

### Task 3: The behaviour check, written first

**Files:**
- Create: `scripts/api-checks/owner-close-steps.mjs`, in the style of `owner-close.mjs`: `call`, `check` and `done` from `harness.mjs`, its own `db()`, and `callAsUser` for the powers.
- Modify: `.github/workflows/ci.yml`. Add a step `node scripts/api-checks/owner-close-steps.mjs` right after the owner-close step, with the same env.
- Modify: `scripts/api-checks/owner-close.mjs`. The check `only income can be locked so far` becomes:
  - `an unknown step cannot be locked`: stage `gp` → 422 `Say which step to lock: income, deductions or O2.`

**Fixture.** Pick it the way owner-close.mjs picks its unit:
- `u` is a share unit, with no contract or a management contract with no minimum, whose October and November statements are not final.
- Turn its misc charge on (`units.misc_charges = 1`) and put it back at the end.
- Insert an October owner-charged cost `c0`: RM 120.00, category `other`, dated 2026-10-10.
- Insert an October owner adjustment `a0`: credit RM 30.00, dated 2026-10-05, unit `u`.
- Insert a held owner adjustment `h0`: charge RM 10.00, dated 2026-09-15, unit `u`, state `held`.
- `w` is an owner with two share units, `w1` first (by building, then unit number) and `w2`.
- `pct` is u's owner %, read as owner-close.mjs reads it.
- Every amount is in sen. `near(a, b)` allows 1 sen.

**Checks, by name** (the plan's tasks name these when they turn them green):

| # | Check | What it does and expects |
|---|---|---|
| D1 | `deductions can be locked` | POST lock `{ stage: 'deductions', unitIds: [u] }` → 201, locked [u]. Again → 200, already [u]. |
| D2 | `the page shows the deductions lock` | GET → `units[u].locks.deductions.by` set; `counts.deductions.locked ≥ 1`. |
| D3 | `a new cost on a locked month goes on the next open one` | POST `/api/expenses` (RM 50, `other`, 2026-10-20, owner) → row `deduct_month` 2026-11, `rolled`. `notice` = `rolledText(label, 'October 2026', 'November 2026', 'locked')`. |
| D4 | `the locked month keeps its deductions` | GET October: `units[u].deductions.total` is the same as before D3. |
| D5 | `a cost written straight into the table moves too` | SQL insert of an owner cost dated 2026-10-21 → `deduct_month` 2026-11. |
| D6 | `editing a locked cost keeps the month and posts the difference` | PATCH `c0` to RM 150 → 200, `notice` = `editedText(…)`. October total unchanged. Generate November → one `stage_lock` adjustment with `lateText('deductions', …)` and amount `near(-round(3000 × pct / 100))`. |
| D7 | `a locked cost cannot be removed` | DELETE `c0` → 409, message = `refusedText('deductions', label, 'October 2026')`. |
| D8 | `the misc charge stays as locked` | Insert a 5-night October stay on `u` (income not locked). October misc is unchanged. The deductions adjustment moves by `near(-round(Δmisc × pct / 100))`. Δmisc is the change in `round(10000 × min(1, nights / 31))`, worked out from the unit's October nights before and after (misc never goes over RM 100). |
| D9 | `with income locked too, the misc difference goes with income` | Lock income. Insert a 3-night October stay paying RM 300. Generate → the income adjustment is `near(round((30000 − round(10000 × 3/31)) × pct / 100))`. The deductions adjustment is unchanged. |
| D10 | `unlocking income moves the misc difference to deductions` | Unlock income with a reason → the income adjustment is gone. The deductions adjustment now also carries the misc change of both stays. |
| D11 | `unlocking deductions brings the month back` | Unlock deductions → its adjustment is withdrawn. October deductions follow today's costs: RM 150, and the misc of the live occupancy. |
| D12 | `a new cost rolls past a final month too` | Lock deductions again. Mark u's owner's November statement `finalised` (SQL). POST a cost dated 2026-10 → `deduct_month` 2026-12. Put November back to `provisional`. |
| D13 | `a locked cost moved out of the month leaves the month as locked` | PATCH a locked October cost's date to 2026-11-05 → October total unchanged. November's live deductions include it. After generate, the deductions adjustment has moved by `near(+round(cost × pct / 100))`. |
| D14 | `utility bills: a locked month's bill rolls, and a locked bill is not replaced` | POST `/api/expenses/utilities`, as `late-bills.mjs` does, for u and 2026-10 → saved with `deductMonth` 2026-11. Re-posting a bill that replaces one deducted in locked October → listed under `locked`, and the old bill is still there. |
| O1 | `O2 can be locked` | POST lock `{ stage: 'o2', unitIds: [u] }` → 201. The lock keeps `a0`. |
| O2 | `a new owner adjustment for a locked month is dated into the next open one` | POST `/api/owners/:owner/adjustments` (unit u, credit RM 25, 2026-10-15) → row `occurred_on` 2026-11-01. `notice` = `movedO2Text(label, 'October 2026', 'November 2026')`. |
| O3 | `a locked owner adjustment cannot be held, settled or deleted` | `a0`: PATCH hold → 409, PATCH settle → 409, DELETE → 409. Each message = `refusedText('o2', label, 'October 2026')`. |
| O4 | `nothing is released into a locked month` | `h0`: release into 2026-10 → 409. The message ends `Release it into November 2026 instead.` Release into 2026-11 → 200. |
| O5 | `October's statement keeps its locked O2` | Generate October for u's owner → u's adjustment lines are exactly `a0`. Generate November → the O2 and O4 adjustments are on it. |
| O6 | `an owner adjustment with no unit is dated past the first unit's locked O2` | Lock O2 for `w1`. POST an adjustment for owner w with no unit, dated 2026-10-20 → `occurred_on` 2026-11-01. |
| O7 | `a late difference skips a locked O2 month` | Lock u's October income again (D10 unlocked it). Insert an o2 lock row for (u, 2026-11) by SQL, keeping u's open November adjustments; November cannot be locked through the route until it ends. Raise an October reservation of u by RM 50 → generate. The new income difference is dated 2026-12-01. The deductions difference already on November stays there. |
| P1 | `without the powers, deductions and O2 cannot be locked` | As the finance admin used in owner-close.mjs (0303 closed both areas): deductions → 403 `You can't lock deductions. Ask management for the Lock deductions permission.`; o2 → 403 `You can't lock O2. Ask management for the Lock O2 permission.` |

Clean up the check's own rows at the end, as owner-close.mjs does.

- [ ] **Step 1: Write the check** as above.
- [ ] **Step 2: Run it against a fresh database and watch it fail.**
  - Use the local recipe: PGlite on 55442, then `wrangler pages dev dist --port 8788`.
  - Run the earlier checks first, in CI order.
  - Expected: it stops at D1 with 422 `Only income can be locked so far.`
- [ ] **Step 3: Commit**: `test(locks): behaviour check for deductions and O2 locks (fails until built)`.

---

### Task 4: The engine works a locked unit-month out from its kept costs, misc and O2

**Files:**
- Modify: `functions/_lib/ownerStatement.ts`:
  - `computeUnitMonth` (line 279);
  - `Inputs` (448);
  - `loadInputs` (468–538);
  - `computeMonth` (562–577).
- Modify: `functions/api/statements/generate.ts`, the line inserts (about 108–125).

**Interfaces:**
- Produces:
  - `export interface FrozenDeductions { costs: CostRow[]; misc: { amount: number; exact: number } | null }`. With `misc: null`, misc is worked out from occupancy as usual.
  - `export interface FrozenO2 { adjustments: AdjustmentRow[] }`.
  - `export function freezeDeductions(m: UnitMonth, costs: CostRow[]): FrozenDeductions`:
    - costs: the unit's costs whose `deductMonthOf(c) === m.month`, exactly as loaded;
    - misc: amount = the misc group's amount; exact = `m.deductionsExact −` the sum of those costs.
  - `export function freezeO2(m: UnitMonth, adjustments: AdjustmentRow[]): FrozenO2`. The rows whose ids are in `m.adjustmentIds`, each with `unit_id = m.unitId`.
  - `Inputs.deductions?: Map<string, FrozenDeductions & { lockId: string }>` and `Inputs.o2?: Map<string, FrozenO2 & { lockId: string }>`, keyed `` `${unitId}|${month}` ``. `Inputs.frozen` stays the income map.
  - `export const withoutMisc = (d: Inputs['deductions']): Inputs['deductions']`. The same map with every `misc` set to null; the sync uses it for its `incomeLive` run.
  - `computeUnitMonth(month, unit, terms, stays, costs, adjustments, miscMonthly, frozen?, deductions?: FrozenDeductions)`:
    - with `deductions`, its costs replace the unit's live costs;
    - its `misc`, when not null, replaces the misc worked out from occupancy;
    - a master lease still deducts nothing.
  - `loadInputs`:
    - the locks list reads every stage, so add `l.stage`;
    - it fills the three maps;
    - kept costs and adjustments get the same conversions as live ones (`ymd(incurred_on)`, `Number(amount)`).
  - `computeMonth`:
    - it passes `inputs.deductions?.get(key)` to each unit;
    - in `'open'` mode only, for an owner with O2-locked units in the month:
      - every id those locks keep is left out of the owner's live list;
      - each O2-locked unit takes its kept adjustments instead;
      - so a no-unit adjustment kept on the first unit never also lands on another unit;
    - `'dated'` mode is unchanged. Reports read adjustments by date, and Task 7 keeps a locked month's dates still.
  - generate.ts: before inserting lines, set `expense_id` and `adjustment_id` to null where the row is gone. Use one query for each, over the ids in the lines. A locked month prints what it kept, and the foreign keys would refuse a missing row.

- [ ] **Step 1: Implement.** Every existing caller keeps its arguments.
- [ ] **Step 2: Type-check.** Run: `npx tsc -b`, then remove `tsconfig.tsbuildinfo`. Expected: no errors.
- [ ] **Step 3: Commit**: `feat(locks): statements use a locked month's costs, misc and O2`.

The Task 3 check proves the behaviour once Task 5 can take the locks.

---

### Task 5: Locking, unlocking and the late sync for every step; the routes

**Files:**
- Modify: `functions/_lib/ownerLocks.ts`.
- Modify: `functions/api/owner-close/index.ts`, `lock.ts` and `unlock.ts`.
- Modify: `functions/_lib/access.ts`:
  - AREAS: after `lockIncome`;
  - the `why` of the existing `owner-close/(lock|unlock)` ROUTE_AREAS entry.
- Modify, renaming the sync calls:
  - `functions/api/statements/generate.ts`;
  - `functions/api/airbnb-recon/decisions.ts` and `undo.ts`;
  - `functions/_lib/cronJobs.ts`.

**Interfaces:**
- Consumes: Task 1 (`lockable`, `splitLate`, `lateText`); Task 4 (`freezeDeductions`, `freezeO2`, `withoutMisc`, `Inputs.deductions`, `Inputs.o2`).
- Produces:
  - **`closedMonthsFor(env, unitIds, fromMonth, stage: Stage): Promise<Map<string, Set<string>>>`.** For each unit, the months from `fromMonth` that are final for its owner, plus the months locked for `stage` for the unit.
  - **`lockStage(env, who, month, stage, unitIds)` → `{ locked, already, notLockable, final, unknown }`.** `lockIncome` becomes a call of this.
    - It loads every unit of the ticked units' owners (`{ ownerIds }`), so each owner's first unit is the same as on the statement.
    - What each stage keeps:
      - income: `freezeIncome`, as now;
      - deductions: `freezeDeductions` on the `'dated'` run with every lock applied;
      - o2: `freezeO2` on an `'open'` run, using the month's statement ids.
    - Audit `owner_report.lock`, with `{ month, stage }` as after.
  - **`closeSteps(env, month)`.** The one place the page reads. It returns:
    - `inputs`;
    - `dated: UnitMonth[]` and `open: UnitMonth[]`;
    - `locks: Map<unitId, Partial<Record<Stage, LockRow>>>`;
    - `finals`;
    - `held: Map<unitId, number>`. A held adjustment with no unit counts on the owner's first unit;
    - `steps: Record<Stage, string[]>`:
      - income and deductions: units with activity whose basis can be locked;
      - o2: units with activity, or with adjustments in the `'open'` run;
    - `counts: Record<Stage, { locked: number; total: number }>`, counted as income is now.
    - `incomeStep` and `incomeLockCounts` keep their meaning for the reconciliation.
  - **`syncLate(env, scope?, o?)`** replaces `syncLateIncome`, with the same return. Rename every caller.
    - It reads the income and deductions locks in scope.
    - For each month it runs:
      - `statement`: the inputs as loaded;
      - `incomeLive`: `{ ...inputs, frozen: undefined, deductions: withoutMisc(inputs.deductions) }`, only needed for units with both locks;
      - `live`: `{ ...inputs, frozen: undefined, deductions: undefined }`.
    - `splitLate` gives each lock its difference.
    - The text is `lateText(stage, …)`. The audit label is `Late income update` or `Late deductions update`.
    - `target = openMonthAfter(month, closedMonthsFor(…, 'o2'))`.
    - `postedFor` counts an adjustment kept by an O2 lock as not movable.
  - **`unlockStage`** works for every stage.
    - The balancing line is dated the first month from the unlocked month that is neither O2-locked for the unit nor final.
    - Unlocking O2 only deletes the lock: it posted nothing.
  - **`POST /api/owner-close/lock`:**
    - `stage` must be in `STAGES`. Otherwise 422 `Say which step to lock: income, deductions or O2.`
    - Each stage has its power: `lockIncome`, `lockDeductions` or `lockO2`. Without it → 403 with the text in Task 3 P1 (income keeps its own).
  - **`GET /api/owner-close`** returns:
    ```ts
    interface CloseUnit {
      unitId: string; building: string; unit: string; ownerName: string; statementFinal: boolean;
      steps: Stage[];
      income: { reservations: number; nights: number; amount: number; toConfirm: number; warnings: string[] };
      deductions: { cleaning: number; utilities: number; additional: number; misc: number; total: number; checks: string[] };
      o2: { credits: number; charges: number; net: number; checks: string[] };
      locks: Record<Stage, { by: string; at: string } | null>;
    }
    // { month, today, lockProblem, may: { lockIncome, lockDeductions, lockO2, unlock }, airbnbFiles,
    //   counts: Record<Stage, { locked, total }>, units: CloseUnit[] }
    ```
    - Deductions figures come from the `'dated'` run's groups:
      - cleaning = basic + deep;
      - utilities = electricity + water + internet + IndahWater;
      - additional;
      - misc;
      - total = `deductions`.
    - Deduction checks use `deductionChecks`:
      - check-outs: today's stays of the unit that check out in the month;
      - contract end: `terms.activeTo`.
    - O2 figures come from the `'open'` run's adjustment lines for the unit: positive lines are credits, negative lines are charges, plus the net.
    - O2 checks use `o2Checks`:
      - held: from `held`;
      - repeats: the unit's O2 lines whose amount and description match one dated in the previous month.
  - **Areas:**
    - `{ key: 'lockDeductions', label: 'Lock deductions', group: 'Finance', api: [], managed: true }`;
    - `{ key: 'lockO2', label: 'Lock O2', group: 'Finance', api: [], managed: true }`.

- [ ] **Step 1: `closedMonthsFor` and `lockStage`.**
- [ ] **Step 2: `closeSteps` and the GET payload.**
- [ ] **Step 3: `syncLate`, `postedFor`, and the unlock balancing date.**
- [ ] **Step 4: The routes and the areas.**
- [ ] **Step 5: Type-check, then run the checks.**
  - `npx tsc -b`; then owner-close.mjs; then owner-close-steps.mjs.
  - Expected: owner-close.mjs all ok. Of the new check: D1, D2, D4, D8–D11, O1, O5, O7 and P1 ok. D3, D6, D7, D12–D14 and O2–O4, O6 still fail; Tasks 6 and 7 make them pass.
- [ ] **Step 6: Commit**: `feat(locks): lock deductions and O2; one late sync for income and deductions`.

---

### Task 6: Writes to costs

**Files:**
- Create: `functions/_lib/lockGuards.ts`. These are the helpers routes call; ownerLocks.ts stays about locks.
- Modify:
  - `functions/api/expenses/index.ts`: POST, the insert at about line 66;
  - `functions/api/expenses/[id].ts`: PATCH about line 74, DELETE about line 97;
  - `functions/api/expenses/utilities.ts`: GET `rollsTo` about 53; the months about 122 and 140; the replace guard about 141 and 153;
  - `functions/_lib/utilityScan.ts`: about 103 and 148;
  - `functions/api/maintenance/issues/[id]/complete.ts`: the prior cost's check about 45, and its RM 0 delete about 58.
- Modify, UI:
  - `src/pages/ExpensesPage.tsx`: add and edit;
  - `src/pages/owners/Costs.tsx`: BillModal;
  - `src/pages/units/DeductionPanel.tsx`;
  - `src/pages/owners/ExpenseEntry.tsx`.

**Interfaces:**
- Consumes: `closedMonthsFor` (Task 5) and the texts (Task 1).
- Produces, in `lockGuards.ts`:
  - `unitLabel(env, unitId): Promise<string>`: building name and unit number, as `lateText` uses.
  - `costNotice(env, c: { unitId: string; incurredOn: string; deductMonth: string }): Promise<string | null>`. It returns `rolledText` when `deductMonth` is later than the month of `incurredOn`: `'locked'` when that month's deductions are locked for the unit, else `'final'`.
  - `editNotice(env, unitId, deductMonth): Promise<string | null>`. `editedText` when that month's deductions are locked for the unit.
  - `costLockProblem(env, unitId, deductMonth): Promise<string | null>`. `refusedText('deductions', …)` when the month's deductions are locked.
- Route changes:
  - **POST /api/expenses:**
    - the insert returns `deduct_month` and `rolled` (`RETURNING`), and the answer gives those rather than its own guess;
    - the answer adds `notice: await costNotice(...)`.
  - **PATCH /api/expenses/:id:**
    - the answer adds `notice: await editNotice(...)` for the row's month after the update;
    - a final month is still refused first.
  - **DELETE /api/expenses/:id:** after the final check, `costLockProblem` → 409 with its text.
  - **Utility bills screen:**
    - `finalMonthsFor` becomes `closedMonthsFor(…, 'deductions')` for `rollsTo`, the deduction months, and the replace guard. A bill that would replace one in a locked month is listed under `locked`, as a final one is.
    - GET adds `rollsWhy: 'locked' | 'final'` per unit, so the banner can use `rolledText`.
  - **Scan bills:** same swap. Its toast already says how many go on a later statement.
  - **Maintenance complete:** when the job's earlier cost sits on a locked month, both the edit and the RM 0 delete → 409 `costLockProblem`.
  - **Cleaning charges:** `chargeClean` (`functions/_lib/cleaning.ts`) reads back the row's `deduct_month` (`RETURNING`) and returns `rolledTo` when it is later than the clean's month. The clean-charges catch-up answers how many rolled, and its toast on Costs.tsx adds `{n} go on a later statement (late bill).`
  - **Approvals:** nothing more. The trigger moves the cost, and a final month is still refused as now.
  - **UI:**
    - after a save, show `notice` in an info toast;
    - in Costs.tsx and DeductionPanel, `Goes on {bill month}` becomes `Goes on the {bill month} statement, or the next open one if that month is final or its deductions are locked.`;
    - ExpenseEntry's banner uses `rolledText` with `rollsWhy`.

- [ ] **Step 1: Write `lockGuards.ts`** (cost helpers).
- [ ] **Step 2: Change the routes.**
- [ ] **Step 3: Change the screens.**
- [ ] **Step 4: Run** `npx tsc -b`, `npm run check`, then late-bills.mjs, utility-listing.mjs, owner-close.mjs and owner-close-steps.mjs. Expected: all ok except O2–O4 and O6.
- [ ] **Step 5: Commit**: `feat(locks): costs for a locked month go on the next open statement; locked costs cannot be removed`.

---

### Task 7: Writes to owner adjustments

**Files:**
- Modify: `functions/_lib/lockGuards.ts`.
- Modify:
  - `functions/api/owners/[id]/adjustments/index.ts`: POST;
  - `functions/api/owners/[id]/adjustments/[adjId].ts`: release about 36–51, hold and settle about 53–81, DELETE about 87–108;
  - `functions/_lib/approvals.ts`: the adjustment insert about 344;
  - `functions/_lib/utilityRequests.ts`: `ownerPaidCredit`;
  - `functions/_lib/utilityScan.ts`: the O2 lines about 168–178;
  - `functions/_lib/airbnbConfirmLoad.ts`: `ConfirmContext`;
  - `functions/_lib/airbnbConfirm.ts`: `planLine`'s posting month.
- Test: `src/lib/airbnbConfirm.test.mjs`.
- Modify, UI: owner adjustment create (`src/pages/owners/Costs.tsx`, the maintenance-fee path, and `src/pages/units/DeductionPanel.tsx`) shows `notice` in an info toast.

**Interfaces:**
- Produces, in `lockGuards.ts`:
  - **`o2Date(env, ownerId, unitId: string | null, date: string): Promise<{ occurredOn: string; notice: string | null }>`.**
    - The unit is the given one. With no unit, it is the owner's first unit that month, as `computeMonth` picks it: building, then unit number, the first that is not a master lease.
    - When the month of `date` is O2-locked for that unit: `` `${openMonthAfter(month, closedMonthsFor(…, 'o2'))}-01` `` and `movedO2Text`.
    - Otherwise: `date`, and no notice.
  - **`o2LockProblem(env, a: { id: string; unit_id: string | null; owner_id: string; occurred_on: string }): Promise<string | null>`.**
    - It returns `refusedText('o2', …)` when an O2 lock keeps the adjustment (`frozen->'adjustments' @> [{"id": …}]`), or when it is dated in a month that is O2-locked for its unit.
- Route changes:
  - **Create** (POST, and the approval when it runs): `occurredOn` goes through `o2Date`. The answer adds `notice`. A staged approval stores the moved date, and its executor checks it again.
  - **Release:** if the month it would land in (the one given, or its own) is O2-locked for its unit → 409 `refusedText(...)` + ` Release it into ${next} instead.`
  - **Hold, settle, DELETE:** `o2LockProblem` → 409.
  - **"Owner paid this bill" and Scan bills O2 lines:** `occurred_on` is `o2Date(owner, unit, '${deductMonth}-01')`.
  - **Airbnb reconciliation:**
    - `ConfirmContext.o2Locked: Map<string, Set<string>>` holds the unit's O2-locked months;
    - the month a change is posted on is `openMonthFrom(month, finals ∪ o2Locked(unit))`;
    - `finals` alone still decides whether a month needs a posted change at all.

- [ ] **Step 1: Write the failing unit test** in `airbnbConfirm.test.mjs`: `a confirmed change on a final month is posted past an O2-locked month`. September is final, October is O2-locked for the unit, so the change is posted on November. Run `node --test src/lib/airbnbConfirm.test.mjs`. Expected: FAIL (posted on October).
- [ ] **Step 2: Implement the helpers and the route changes.** Run the test. Expected: PASS.
- [ ] **Step 3: Change the screens.**
- [ ] **Step 4: Run** `npx tsc -b`, `npm run check`, then airbnb-recon.mjs, owner-close.mjs and owner-close-steps.mjs. Expected: all ok.
- [ ] **Step 5: Commit**: `feat(locks): owner adjustments for a locked month are dated into the next open one; locked ones stay as they are`.

---

### Task 8: The Deductions and O2 steps on Owner statement close

**Files:**
- Modify: `src/pages/owners/OwnerReportClosePage.tsx`.

**Interfaces:**
- Consumes: GET `/api/owner-close` and POST `/lock` and `/unlock` (Task 5).

- [ ] **Step 1: Build the steps.** Follow screens 2–4 of `exports/lock-flow-mockup-2026-11-11.html` and the dashboard-design guidance.
  - **Step strip.** The Income, Deductions and O2 tiles become buttons (URL `step`, default `income`), showing `X of Y` and `units locked`. GP and final stays `Later`.
  - **Filters.** Per step: Not locked / Needs a look / Locked / All, counted over that step's units. Needs a look:
    - Income: as now;
    - Deductions and O2: `checks.length > 0`.
  - **Table.** `DataTable` with id `owner-close.${step}`. Columns:
    - Income: as now;
    - Deductions: Unit (owner below), Cleaning, Utilities, Additional, Misc, Total (all money, right-aligned), Check, Status;
    - O2: Unit, Credits, Charges, Net O2 (money), Check, Status.
  - **Selection.** `selectable` = the step's power, no `lockProblem`, not locked for that step, and not `statementFinal`.
  - **Lock dialog.**
    - Title: `Lock October 2026 deductions for 3 units?`, or `… O2 …`.
    - Body: the unit list, and the ticked units that still need a look, as the Income dialog does now (a warning, never a block: spec call 4).
    - Deductions meta: `After this, a new cost for their October 2026 goes on the next open statement, and a change to a locked cost goes there as an owner adjustment.`
    - O2 meta: `After this, a new owner adjustment for their October 2026 is dated into the next open month, and their October 2026 owner adjustments can't be held, released, settled or deleted.`
  - **Lock toast.** `Deductions locked for 3 units.`, or `O2 locked …`, plus the skipped reasons. Deductions `notLockable`: `a fixed rent or master lease is not on this step yet`.
  - **Unlock dialog body:**
    - Deductions: `The month goes back to today's costs. A difference already moved to a later month comes back, unless that month is final.`
    - O2: `The month's statement takes today's owner adjustments again.`
  - **Export names:** `owner-statement-close-${step}-${month}`.
- [ ] **Step 2: Check the copy.** Run: `npm run check` (english-only and vocabulary). Expected: pass.
- [ ] **Step 3: See it working.**
  - Run vite against the local API, using a temporary `.claude/launch.json` entry on port 5181 and removing it afterwards.
  - Sign in as management with the harness cookie.
  - On each step, lock two units and unlock one with a reason.
  - Check dark mode and phone width: no sideways page scroll; the table scrolls inside.
  - Take screenshots.
- [ ] **Step 4: Commit**: `feat(locks): Deductions and O2 steps on Owner statement close`.

---

### Task 9: Run everything, then record it

**Files:**
- Modify: `docs/finance/FINANCE-SOP.md` §9.1.
  - Add the Deductions and O2 sections, in Chinese like the Income one.
  - Update 还没做 so it lists 2b and part 3.
- Modify: this plan. Add an "As built" section at the end.

- [ ] **Step 1: The whole suite.**
  - Run: `npm test`, `npm run check`, `npx tsc -b`.
  - Then the CI order on a fresh database: role-access, unit-costs, late-bills, utility-listing, unit-pnl, yearly-report, airbnb-recon, owner-close, owner-close-steps, demo-mode.
  - Expected: all ok. The exceptions are the 3 known `npm test` failures, and the lines that need CI's operations-staff user. rbac-matrix runs in CI only; this plan adds no route.
- [ ] **Step 2: Write the SOP and As built.**
- [ ] **Step 3: Commit**: `docs(locks): SOP month close (deductions and O2) and plan as built`.

---

## After the tasks (not code)

1. Whole-branch review by a fresh reviewer on the most capable model, then one fix pass. Each fix gets a test that failed first.
2. Open the PR. CI runs every check.
3. Before asking for 0303, confirm that `migrate-production.yml` applies `migrations-pg/` only (the engine has its own 0303). Then ask chew for the go: dry run, then apply, with only=0303.
4. After merge and deploy, verify on production, read-only:
   - the two areas are `none` for every department;
   - the trigger is the new one: `SELECT prosrc LIKE '%owner_report_locks%' FROM pg_proc WHERE proname = 'expenses_deduct_month'`.
5. Tell chew:
   - the Deductions and O2 steps are on Owner statement close;
   - she gives Lock deductions and Lock O2 per person in Users and roles; only management has them until then;
   - where late costs and late owner adjustments go;
   - that 2b and part 3 come next.

## Not in this plan

- **2b:** the company's share of a late change in the unit P&L, the yearly report and the portfolio (choice A); fixed-rent units on Income and Deductions; the notice on a manual reservation edit.
- **Part 3:** Final needs all three locks; Unlock final with a Cancelled payout state; the Locks column; the Agent/Company split and the agent % fill.
- **Final months:** costs on a final month keep today's rules; see Global Constraints.
- The deferred minors from part 1's review, which this plan does not touch.
