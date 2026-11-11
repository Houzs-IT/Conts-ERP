# Owner report locks, part 1 (Income) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chew, and the people she gives the power to, can tick units on a new Owner report close page and lock a month's income. A locked month's income never changes again. A later change to one of its bookings reaches the owner as an owner adjustment in the next open month. Unlocking, with a reason, brings the month back.

**Architecture:**
- A new table `owner_report_locks` holds one row per unit, month and stage, with who locked it and when. For income it also keeps the frozen stays and the frozen rent as JSON.
- The statement engine (`functions/_lib/ownerStatement.ts`) reads income locks in `loadInputs` and works out a locked unit-month from the frozen stays. Statements, the Overall owner report and the dashboards therefore all show the locked figures.
- A sync (`syncLateIncome`) compares each locked unit-month's live owner payout with its frozen one. It keeps one owner adjustment per lock on the next open month for the difference (source `stage_lock`). It runs before statement generation, after Airbnb reconciliation confirms and undos, and every 15 minutes from the cron.

**Tech Stack:**
- Cloudflare Pages Functions (TypeScript), Postgres schema `pos`.
- React with the project's `DataTable`, `useConfirm` and toast.
- `node --test src/lib/*.test.mjs` for pure logic, and `scripts/api-checks/*.mjs` against a local PGlite database with `wrangler pages dev` for behaviour.

**Spec:** `docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md` (approved by chew, 11 Nov 2026).

The spec is built in three parts, each shipped on its own:
1. **This plan:** the lock store, the Income stage, the locks page, the permissions, and the Airbnb reconciliation banner.
2. Deductions and O2 locks: guards on every expense and owner-adjustment write, and the misc freeze.
3. Final: Make final only when all three are locked, Unlock final with a Cancelled payout state, and on the Overall owner report the Locks column, the Agent and Company split, and the agent % fill.

## Global Constraints

- **Text:** product text in English (British). No CJK in `src/` (english-only check). Say "owner adjustments", never "owner credit" (vocabulary check).
- **Lock start:** no lock for a month before `2026-10`, as the spec's non-goal says. Message: "Locks start from October 2026."
- **Locking:** only ticked units are locked; nothing is locked "except" something.
- **History:** every lock and unlock records who did it and when. Every unlock records a reason: required, 1–500 characters, written to `audit_log`.
- **A locked figure never changes.** A late change goes to the next open month and is never dropped.
- **Permissions:** the new access areas are closed for every department until management opens them; management is always Full. chew gives them per person.
- **Migrations:** run through `migrate-production.yml`, dry run first, only with chew's OK each time. Production SQL through MCP is insert/update only, with no DROP or DELETE, even in comments.
- **New tables:** `OWNER TO pos_app`, `GRANT … TO pos_app`, and `select demo.drop_views();` / `select demo.sync();` around the schema change.
- **Tests:**
  - Pure logic tested by `node --test` must live in a file with no extensionless value imports (Node cannot resolve them).
  - Run `tsc -b` on its own.
  - `scripts/api-checks/rbac-matrix.expected.json` uses CRLF line endings.
- **Toasts:** tones are success, warning, critical, info and neutral.

## Review Focus

1. **A stay that crosses months.** Example: 29 Oct – 6 Nov, with its amount changed after October income is locked. October keeps its frozen part; November's own part follows the change; October's difference lands on November as one owner adjustment. Tested in Task 6.
2. **The same unit and month locked twice** (two people, or a double click). The second lock is a no-op, reported as "already locked", with no error and no duplicate row. Tested in Task 5.
3. **The sync runs again and again** (cron, generate, reconciliation). Still exactly one adjustment per lock and target month, and the amount never doubles. Tested in Tasks 3 and 6.
4. **Unlock when the difference already sits on a final statement.** The spec's call 9: the difference stays where it is, and the unlocked month gets a balancing owner adjustment ("Already settled on the November 2026 statement"), so the owner is never paid twice. Unlocking a month whose own statement is final is refused. Tested in Tasks 2 and 6.
5. **A long-term let.** Its income is the tenant's rent. When its contract dates change after the lock, October's rent stays and the difference is posted. Tested in Task 6.

---

### Task 1: Migration — the lock table, a new adjustment source, closed areas

**Files:**
- Create: `migrations-pg/0302_owner_report_locks.sql`. This was the next free number on 11 Nov 2026 (main and every branch end at 0301; production last applied 0301). Re-check before merging and renumber if taken.

**Interfaces:**
- Produces:
  - table `owner_report_locks(id, month, unit_id, stage, frozen, locked_by, locked_by_name, locked_at)`, unique on `(month, unit_id, stage)`;
  - `owner_adjustments.source` may be `'stage_lock'`;
  - areas `ownerClose`, `lockIncome` and `unlockStep`, closed for every department.

- [ ] **Step 1: Write the migration**

```sql
-- Owner report stage locks, part 1 (spec docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md).
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0302, dry run first.
select demo.drop_views();

CREATE TABLE IF NOT EXISTS owner_report_locks (
  id              TEXT PRIMARY KEY,
  month           TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$' AND month >= '2026-10'),
  unit_id         TEXT NOT NULL REFERENCES units(id),
  stage           TEXT NOT NULL CHECK (stage IN ('income', 'deductions', 'o2')),
  frozen          JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_by       TEXT NOT NULL,
  locked_by_name  TEXT NOT NULL,
  locked_at       TEXT NOT NULL,
  UNIQUE (month, unit_id, stage)
);
CREATE INDEX IF NOT EXISTS owner_report_locks_unit ON owner_report_locks (unit_id, stage, month);
ALTER TABLE owner_report_locks OWNER TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_report_locks TO pos_app;

ALTER TABLE owner_adjustments DROP CONSTRAINT IF EXISTS owner_adjustments_source_check;
ALTER TABLE owner_adjustments ADD CONSTRAINT owner_adjustments_source_check
  CHECK (source IN ('manual', 'owner_workbook', 'airbnb_recon', 'stage_lock'));

-- Closed for every department until management opens them (chew assigns them per person).
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, a.area, 'none', 'migration 0302'
FROM departments d CROSS JOIN (VALUES ('ownerClose'), ('lockIncome'), ('unlockStep')) a(area)
ON CONFLICT (scope, scope_id, area) DO NOTHING;

select demo.sync();
```

- [ ] **Step 2: Apply it to a fresh local database and check it**

Run: `PORT=55441 node scripts/dev-pglite.mjs`. It applies every migration and prints a `ready:` line. Then:

`SELECT to_regclass('pos.owner_report_locks') IS NOT NULL AS t, (SELECT count(*) FROM pos.access_rules WHERE area = 'lockIncome') AS n;`

Expected: `t = true`, `n` = the number of departments.

- [ ] **Step 3: Commit** — `git add migrations-pg/0302_owner_report_locks.sql && git commit -m "feat(locks): owner report lock table, stage_lock adjustments, closed areas (migration 0302)"`

---

### Task 2: Pure lock rules

**Files:**
- Create: `functions/_lib/stageLocks.ts`. It may have no imports at all, so that `node --test` can load it.
- Test: `src/lib/stageLocks.test.mjs`.

**Interfaces:**
- Produces:
  - `export type Stage = 'income' | 'deductions' | 'o2'`
  - `export const LOCK_FROM = '2026-10'`
  - `export function lockMonthProblem(month: string): string | null`: null when `month >= LOCK_FROM`; otherwise "Locks start from October 2026.".
  - `export function monthAfter(month: string): string`
  - `export function monthLabel(month: string): string`: `'2026-10'` → `'October 2026'`.
  - `export function openMonthAfter(month: string, closed: ReadonlySet<string>): string`: the first month after `month` that is not in `closed`.
  - `export interface PostedLate { id: string; month: string; amount: number; movable: boolean }`. `movable` means not on a final statement (and, from part 2, not in an O2-locked month).
  - `export type LatePlan = { kind: 'none' } | { kind: 'insert'; month: string; amount: number } | { kind: 'update'; id: string; amount: number } | { kind: 'remove'; id: string }`
  - `export function planLate(diff: number, posted: PostedLate[], target: string): LatePlan`
  - `export interface UnlockPlan { problem: string | null; remove: string[]; carried: { amount: number; months: string[] } | null }`
  - `export function planUnlock(posted: PostedLate[], monthIsFinal: boolean, monthLabel: string): UnlockPlan`. It works like this:
    - When the month is final, `problem` = `The ${monthLabel} statement is final. Unlock the final statement first.`
    - Otherwise, `remove` = the movable ids, and `carried` = the sum and months of the rows that are not movable, or null when there are none.
  - `export function carriedText(monthLabels: string[]): string`. Returns: `Already settled on the ${labels joined with ' and '} statement`.
  - `export function lateText(unitLabel: string, monthLabel: string): string`. Returns: `Late change to ${unitLabel} income for ${monthLabel} (income locked)`.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockMonthProblem, openMonthAfter, planLate, planUnlock, carriedText, monthAfter } from '../../functions/_lib/stageLocks.ts';

test('locks start from October 2026', () => {
  assert.equal(lockMonthProblem('2026-09'), 'Locks start from October 2026.');
  assert.equal(lockMonthProblem('2026-10'), null);
});
test('next open month skips closed months and crosses the year', () => {
  assert.equal(monthAfter('2026-12'), '2027-01');
  assert.equal(openMonthAfter('2026-10', new Set(['2026-11', '2026-12'])), '2027-01');
});
test('late difference: insert, top up the open one, remove when back to zero, nothing under a sen', () => {
  assert.deepEqual(planLate(7500, [], '2026-11'), { kind: 'insert', month: '2026-11', amount: 7500 });
  assert.deepEqual(planLate(9000, [{ id: 'a', month: '2026-11', amount: 7500, movable: true }], '2026-11'), { kind: 'update', id: 'a', amount: 9000 });
  assert.deepEqual(planLate(0, [{ id: 'a', month: '2026-11', amount: 7500, movable: true }], '2026-11'), { kind: 'remove', id: 'a' });
  assert.deepEqual(planLate(7500, [{ id: 'a', month: '2026-11', amount: 7500, movable: false }], '2026-12'), { kind: 'none' });
  assert.deepEqual(planLate(9000, [{ id: 'a', month: '2026-11', amount: 7500, movable: false }], '2026-12'), { kind: 'insert', month: '2026-12', amount: 1500 });
});
test('unlock: open differences are withdrawn, final ones are balanced, a final month is refused', () => {
  assert.deepEqual(planUnlock([{ id: 'a', month: '2026-11', amount: 7500, movable: true }], false, 'October 2026'),
    { problem: null, remove: ['a'], carried: null });
  assert.deepEqual(planUnlock([{ id: 'a', month: '2026-11', amount: 7500, movable: false }], false, 'October 2026'),
    { problem: null, remove: [], carried: { amount: 7500, months: ['2026-11'] } });
  assert.equal(planUnlock([], true, 'October 2026').problem, 'The October 2026 statement is final. Unlock the final statement first.');
  assert.equal(carriedText(['November 2026']), 'Already settled on the November 2026 statement');
});
```

- [ ] **Step 2: Run them and see them fail.** Run: `node --test src/lib/stageLocks.test.mjs`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `functions/_lib/stageLocks.ts`** with the signatures above.

  `planLate` works like this:
  - `remaining = diff − Σ posted.amount`.
  - If there is a movable posted row on `target`, its new amount is `row.amount + remaining`. If that new amount is 0, return `remove`; otherwise return `update`, unless `|remaining| < 1`, which returns `none`.
  - Otherwise, `|remaining| < 1` returns `none`, and anything else returns `insert` on `target`.

- [ ] **Step 4: Run the tests and see them pass.** Run: `node --test src/lib/stageLocks.test.mjs`. Expected: all pass.

- [ ] **Step 5: Commit** — `feat(locks): pure rules for stage locks (open month, late difference, unlock refusal)`

---

### Task 3: The engine works a locked month out from its frozen income

**Files:**
- Modify: `functions/_lib/ownerStatement.ts`:
  - `computeUnitMonth` (rent at lines 276–277, stays at 266);
  - `Inputs` (line 426);
  - `loadInputs` (lines 438–493: add the locks list as the last column of the one query);
  - `computeMonth` (line 525).

**Interfaces:**
- Produces:
  - `export interface FrozenIncome { stays: StayRow[]; rent: { tenancyDays: number; rentExact: number } | null }`
  - `Inputs.frozen?: Map<string, FrozenIncome & { lockId: string }>`, keyed `` `${unitId}|${month}` ``.
  - `export function tenancyRentFor(month: string, terms: Terms): { tenancyDays: number; rentExact: number }`. This moves today's two lines into the helper; computeUnitMonth calls it.
  - `computeUnitMonth(month, unit, terms, stays, costs, adjustments, miscMonthly, frozen?: FrozenIncome)`. With `frozen`:
    - `frozen.stays` replaces `stays` for the unit's income, nights and occupancy;
    - `frozen.rent` replaces the tenancy rent when the model is a tenancy.
  - `export function freezeIncome(unitId: string, month: string, stays: StayRow[], terms: Terms): FrozenIncome`. It keeps the unit's stays that overlap the month, exactly as loaded (`parts` and `host_payout` included), and the rent when the model is a tenancy.
  - `loadInputs` fills `frozen` from `owner_report_locks` where `stage = 'income'` and the month is in `[from, toExclusive)`.
  - `computeMonth` passes `inputs.frozen?.get(\`${u.id}|${month}\`)`. A caller that wants the live figures passes `{ ...inputs, frozen: undefined }`.

- [ ] **Step 1: Refactor the rent into `tenancyRentFor`, add the optional `frozen` parameter, `freezeIncome` and `Inputs.frozen`.** Every existing caller keeps its arguments.
- [ ] **Step 2: Load the locks in `loadInputs`.** Add `(SELECT json_agg(x) FROM (SELECT l.id, l.unit_id, l.month, l.frozen FROM owner_report_locks l WHERE l.stage = 'income' AND l.month >= substr(?, 1, 7) AND l.month < substr(?, 1, 7) AND l.unit_id IN (SELECT id FROM su)) x) AS locks` as the last select column, and append `from, toExclusive` as the last two arguments. Convert each `frozen.stays` with the same mapping the live stays get (`ymd` dates, `Number(...)` amounts).
- [ ] **Step 3: Type-check.** Run `npx tsc -b` on its own. Expected: no errors.
- [ ] **Step 4: Commit** — `feat(locks): statements use a locked month's frozen income`

(Behaviour is proven by the API check in Task 6.)

---

### Task 4: Lock, unlock and the late-income sync

**Files:**
- Create: `functions/_lib/ownerLocks.ts`.

**Interfaces:**
- Consumes:
  - `stageLocks.ts` (Task 2);
  - `freezeIncome`, `loadInputs`, `computeMonth`, `withYearToDate`, `statementSettings`, `unitForMonth`, `termsFor` (Task 3, `ownerStatement.ts`);
  - `finalMonthsFor` (`functions/_lib/expenses.ts`);
  - `auditMany` (`functions/_lib/history.ts`);
  - `transaction`, `all`, `one` and `run` (`functions/_lib/db.ts`).
- Produces:
  - `export interface LockRow { id: string; month: string; unit_id: string; stage: Stage; locked_by_name: string; locked_at: string }`
  - `export async function locksFor(env: Env, month: string, unitIds?: string[]): Promise<LockRow[]>`
  - `export async function lockIncome(env: Env, who: { userId: string; fullName: string }, month: string, unitIds: string[]): Promise<{ locked: string[]; already: string[] }>`
  - `export async function unlockStage(env: Env, who: { userId: string; fullName: string }, month: string, stage: Stage, unitId: string, reason: string): Promise<{ ok: true } | { problem: string }>`
  - `export async function syncLateIncome(env: Env, scope?: { unitIds?: string[]; ownerIds?: string[] }, o?: { dryRun?: boolean }): Promise<{ inserted: number; updated: number; removed: number }>`

- [ ] **Step 1: `lockIncome`**
  - Load the month (`loadInputs(q, \`${month}-01\`, monthEndExclusive(month), { unitIds })`) and the settings.
  - For each unit, work out `termsFor(unitForMonth(u, month), settings.defaultFeePct)` and `freezeIncome(...)`.
  - Insert with `ON CONFLICT (month, unit_id, stage) DO NOTHING RETURNING unit_id`. Units not returned are `already`.
  - Use id `` `lock-${crypto.randomUUID()}` ``, `locked_by` = `userId`, `locked_by_name` = `fullName`, `locked_at` = `nowIso()`.
  - Write one audit row per locked unit: action `owner_report.lock`, entity `units`, after `{ month, stage }`.
- [ ] **Step 2: `unlockStage`**
  - Find the lock.
  - Find its posted adjustments (`source = 'stage_lock' AND reference = 'stage-lock:' || lockId`). `movable` = the owner's statement for the adjustment's `occurred_on` month is not finalised, sent or paid.
  - Call `planUnlock(posted, <the lock month's statement is finalised, sent or paid>, monthLabel(month))`. If it returns a problem, return it.
  - Otherwise, in one transaction:
    - delete the `remove` adjustments;
    - when `carried` is set, insert a balancing owner adjustment on the unlocked month:
      - `amount` = −carried.amount, `occurred_on` = `` `${month}-01` ``;
      - `description` = `carriedText(...)`;
      - `source` = `'stage_lock'`, `reference` = `` `stage-lock-carried:${lockId}` ``, `state` = `'open'`;
    - delete the lock;
    - write audit action `owner_report.unlock` with after `{ month, stage, reason }`.
- [ ] **Step 3: `syncLateIncome`**
  - Read the income locks in scope (`ownerIds` → those owners' units) and group them by month.
  - Per month:
    - load inputs (with `withYearToDate`);
    - `frozenRows = computeMonth(month, inputs, settings, 'dated')`;
    - `liveRows = computeMonth(month, { ...inputs, frozen: undefined }, settings, 'dated')`;
    - for each locked unit, `diff = live.payoutBeforeAdjustments − frozen.payoutBeforeAdjustments`.
  - Per lock, inside one transaction holding `pg_advisory_xact_lock(hashtext('stage-lock:' || lockId))`:
    - read the posted rows;
    - `target = openMonthAfter(lock.month, finals of that unit)`;
    - apply `planLate(diff, posted, target)`.
  - A new adjustment gets:
    - id `` `adj-lock-${crypto.randomUUID()}` ``;
    - `owner_id` = the unit's owner, `unit_id` = the unit;
    - `kind` = `credit` when the amount > 0, else `charge`;
    - `amount` = the planned amount, `occurred_on` = `` `${target}-01` ``;
    - `description` = `lateText(\`${property} ${unitNumber}\`, monthLabel(lock.month))`;
    - `reference` = `` `stage-lock:${lockId}` ``, `source` = `'stage_lock'`;
    - `state` = `'held'` when the unit's model is `management_yearly_guarantee` (spec call 10), else `'open'`;
    - `created_by` = `'system'`.
  - With `dryRun`, plan only and do not write.
- [ ] **Step 4: Type-check** — `npx tsc -b`. Expected: no errors.
- [ ] **Step 5: Commit** — `feat(locks): lock and unlock income, post late income differences once`

---

### Task 5: The routes and the permissions

**Files:**
- Create:
  - `functions/api/owner-close/index.ts` (GET);
  - `functions/api/owner-close/lock.ts` (POST);
  - `functions/api/owner-close/unlock.ts` (POST).
- Modify:
  - `functions/_lib/access.ts`: AREAS after `airbnbRecon`, and ROUTE_AREAS;
  - `scripts/api-checks/rbac-matrix.expected.json`: the new routes; keep CRLF.
- Test: `scripts/api-checks/owner-close.mjs` (written in Task 6; this task's checks are in it).

**Interfaces:**
- Consumes: `ownerLocks.ts` (Task 4); `loadMonth` from `functions/api/airbnb-recon/index.ts` for the to-confirm count.
- Produces:
  - **GET `/api/owner-close?month=YYYY-MM`** returns `{ month, may: { lockIncome: boolean; unlock: boolean }, airbnbFiles: number, counts: { income: { locked: number; total: number } }, units: CloseUnit[] }`.
    - `CloseUnit = { unitId, unitLabel, ownerName, bookings: number, nights: number, income: number /* sen */, toConfirm: number, warnings: string[], income_lock: { by: string; at: string } | null }`.
    - Units are those with `hasActivity` in the month, worked out from frozen figures where locked.
    - `toConfirm` = the Airbnb reconciliation lines with `needsConfirm && !decision` whose stay is on the unit, or 0 when no file is uploaded for the month.
  - **POST `/api/owner-close/lock`** `{ month, stage, unitIds: string[] (1–500) }`.
    - Answers `{ locked: string[], already: string[] }`, status 201 when anything is locked, else 200.
    - `stage` other than `'income'` → 422 "Only income can be locked so far."
    - Month problem → 422.
    - No `lockIncome` edit → 403 "You can't lock income. Ask chew for the Lock income permission."
  - **POST `/api/owner-close/unlock`** `{ month, stage, unitId, reason }`.
    - Answers 200 `{ ok: true }`.
    - No reason → 422 "Say why you are unlocking."
    - A problem → 409 with the problem text.
    - No `unlockStep` edit → 403.
  - **Areas:**
    - `{ key: 'ownerClose', label: 'Owner report close', group: 'Finance', api: ['owner-close'], managed: true, strictRead: true }`
    - `{ key: 'lockIncome', label: 'Lock income', group: 'Finance', api: [], managed: true }`
    - `{ key: 'unlockStep', label: 'Unlock a step', group: 'Finance', api: [], managed: true }`
    - ROUTE_AREAS: `{ method: 'POST', path: /^\/api\/owner-close\/(lock|unlock)$/, area: null, why: 'Each stage has its own lock power and unlocking its own; the handler checks them (can()).' }`

- [ ] **Step 1: Add the areas and the route override.** The handlers check `can(session, 'lockIncome', 'edit')` and `can(session, 'unlockStep', 'edit')`.
- [ ] **Step 2: Write the three handlers** with the answers above.
- [ ] **Step 3: Run the rbac matrix check and update the expected file.** Run: `DB_URL=… API_BASE=http://localhost:8788 node scripts/api-checks/rbac-matrix.mjs`. Add the printed rows for the three routes to `rbac-matrix.expected.json`, keeping CRLF. Expected on the rerun: all ok.
- [ ] **Step 4: Commit** — `feat(locks): owner report close routes and lock permissions`

---

### Task 6: The behaviour check (API) and the hooks

**Files:**
- Create: `scripts/api-checks/owner-close.mjs`, written in the style of `scripts/api-checks/airbnb-recon.mjs`: the `call`, `check` and `done` helpers from `harness.mjs`, plus its own `db()`.
- Modify:
  - `functions/api/statements/generate.ts`: call `await syncLateIncome(env, ownerIds ? { ownerIds } : {})` before the transaction;
  - `functions/api/airbnb-recon/decisions.ts` and `functions/api/airbnb-recon/undo.ts`: after the commit, call `await syncLateIncome(env, { unitIds: [...changed units] })`;
  - `functions/_lib/airbnbConfirmLoad.ts`: the final months it passes on exclude the unit's income-locked months, so the reconciliation does not post its own adjustment where the sync will;
  - `functions/_lib/cronJobs.ts`: a new `lateIncomeSweep(env, o)` returning `{ job: 'late-income', summary }`, added to `SCHEDULE[CRON.quarterHour]`;
  - `.github/workflows/ci.yml`: a step `node scripts/api-checks/owner-close.mjs` after the airbnb-recon step, with the same env as that step.

- [ ] **Step 1: Write the check.** It uses a profit-share unit `u` whose October and November 2026 statements are not final; select it as airbnb-recon.mjs does. Checks, in order:
  1. GET October lists `u`, with `income_lock === null`.
  2. POST lock `{ month: '2026-10', stage: 'income', unitIds: [u] }` → `locked` = [u]. Again → `already` = [u].
  3. Lock `2026-09` → 422 "Locks start from October 2026."
  4. Add RM 100 to an October booking of `u`: `UPDATE reservations SET gross_booking_value = gross_booking_value + 10000`. If `u` has none, insert a 2-night October stay. Then GET: October income for `u` is unchanged.
  5. POST `/api/statements/generate { period: '2026-11', ownerIds: [owner] }`. Then exactly one `owner_adjustments` row exists with `source = 'stage_lock'`, `occurred_on = '2026-11-01'` and `amount = round(10000 × owner% / 100)`.
  6. Generate again: still one row, same amount (Review Focus 3).
  7. A stay crossing months (29 Oct – 6 Nov), inserted before the lock in the same fixture, with its amount raised. November's own nights follow the change; the October part comes as the adjustment (Review Focus 1).
  8. Unlock without a reason → 422. With reason `"Correct the booking"` → 200. The adjustment is gone, and GET shows October income including the RM 100.
  9. Lock again, raise again, generate. Mark November's statement `finalised` with `UPDATE … SET state = 'finalised'`. Unlock → 200. The November adjustment stays, and October gains an open adjustment of the same amount negated, described "Already settled on the November 2026 statement" (Review Focus 4). Mark October `finalised` too. Unlock → 409 "The October 2026 statement is final. Unlock the final statement first." Put both back to `provisional` afterwards.
  10. A long-term let unit, if the demo data has one; otherwise turn a unit's contract into `long_term` inside the check. Lock, then change `ends_on`. Income is unchanged and the difference is posted (Review Focus 5).
  11. A staff account with no `lockIncome` → 403. Use `callAsUser` with a staff user whose department has the migration's `none`.
- [ ] **Step 2: Run it against a fresh local database and see it fail where the hooks are missing.** Use the local recipe: PGlite on 55441; `dist/index.html` and `.dev.vars` with `SESSION_SECRET`; then `npx wrangler pages dev dist --port 8788`. Run the earlier CI checks first (unit-costs, late-bills), as CI does.
- [ ] **Step 3: Add the hooks** listed under Files.
- [ ] **Step 4: Run the check until it passes**, then the full CI order: role-access, rbac-matrix, unit-costs, late-bills, utility-listing, unit-pnl, yearly-report, airbnb-recon, owner-close, demo-mode. Expected: all ok.
- [ ] **Step 5: Commit** — `feat(locks): late income sync on generate, reconciliation and the 15-minute cron; API check`

---

### Task 7: The Owner report close page (Income)

**Files:**
- Create: `src/pages/owners/OwnerReportClosePage.tsx`.
- Modify:
  - `src/App.tsx`: lazy route `/owners/close`;
  - `src/lib/navigation.ts`: in the Owners section after `contracts`, add `{ key: 'ownerClose', label: 'Owner report close', icon: 'lock', path: '/owners/close', area: 'ownerClose' }`.

**Interfaces:**
- Consumes: GET/POST `/api/owner-close*` (Task 5).

- [ ] **Step 1: Build the page.** Follow screens 2 and 6 of the mockup (`exports/lock-flow-mockup-2026-11-11.html`) and the dashboard-design guidance:
  - **Month select:** `?month=`, defaulting to the previous calendar month in Malaysia time.
  - **Step strip:** Income shows "X of Y units locked" with a bar. Deductions, O2, and GP and final are shown muted with "Next".
  - **Filter chips:** All / Not locked / Needs a look / Locked. "Needs a look" = `toConfirm > 0 || warnings.length`.
  - **DataTable columns:** Unit, Owner, Bookings, Nights, Income (RM, right-aligned, tabular), Check, Status.
    - Check shows chips: "n bookings to confirm" in the warning tone; each warning, short, in the warning tone; otherwise "All confirmed" in the success tone.
    - Status shows "Not locked" or "Locked · {name} · {d MMM HH:mm}", plus an Unlock button when `may.unlock`.
  - **Selection:** `selectable` = not locked and `may.lockIncome`. `bulkActions` → "Lock income (n)" opens `useConfirm`:
    - title: `Lock {Month} income for n units?`
    - body: the unit list, and for ticked units that need a look, "These still have something to look at: …";
    - meta: "After this, a change to their {Month} income goes to the next open month as an owner adjustment."
    - On confirm, POST, then the toast "Income locked for n units" (success), plus "m were already locked" (info).
  - **Unlock:** `useConfirm` with `reason: { label: 'Why are you unlocking?', maxLength: 500 }`, `danger: true`, then POST. A 409 shows its text in the critical tone.
  - **Banner** when `airbnbFiles === 0`: "No Airbnb file uploaded for {Month} yet. Upload it on Airbnb reconciliation to check the bookings." with a link.
- [ ] **Step 2: Check the copy.** Run the english-only and vocabulary checks (`npm run check:english` and `npm run check:vocabulary`, or the names in package.json). Expected: pass.
- [ ] **Step 3: See it working.** Run vite against the local API (a temporary launch.json entry, removed afterwards). Sign in as management with the harness cookie. Lock two units and unlock one with a reason. Check dark mode and phone width (no page scroll sideways; the table scrolls inside). Take screenshots.
- [ ] **Step 4: Commit** — `feat(locks): Owner report close page, income step`

---

### Task 8: Airbnb reconciliation shows the income locks

**Files:**
- Modify:
  - `functions/api/airbnb-recon/index.ts`: GET adds `incomeLocks: { locked: number; total: number }` for the month, with the same `total` as owner-close's `counts.income.total`. Each line gets `lockedMonths: string[]`: the line's months that are income-locked for its unit.
  - `src/pages/finance/AirbnbReconPage.tsx`: the info banner and the confirm-window hint.
  - `scripts/api-checks/airbnb-recon.mjs`: one check that `incomeLocks` is present.

- [ ] **Step 1: Add the fields and the check.**
  - Banner: `{Month} income is locked for X of Y units.` with the link "Owner report close" to `/owners/close?month=…`.
  - Hint in the confirm window when `lockedMonths.length`: `{Month} income is locked for this unit, so the owner's share of this change goes to the next open month as an owner adjustment.`
- [ ] **Step 2: Run the airbnb-recon and owner-close checks.** Expected: all ok.
- [ ] **Step 3: Commit** — `feat(locks): reconciliation shows income locks`

---

### Task 9: Record it

**Files:**
- Modify:
  - `docs/finance/FINANCE-SOP.md`: a new section on month close (Chinese, like §4.1.1) covering what the income lock does, who can lock or unlock, and where late changes go;
  - this plan: an "As built" section at the end.
- Add: the spec `docs/superpowers/specs/2026-11-11-owner-report-stage-locks-design.md` (committed with this branch).

- [ ] **Step 1: Write both.**
- [ ] **Step 2: Commit** — `docs(locks): SOP month close (income) and plan as built`

---

## After the tasks (not code)

1. Open the PR. CI runs every check.
2. Ask chew for the go to run migration 0302 (dry run, then apply, with only=0302).
3. After merge and deploy, verify read-only on production:
   - GET `/api/owner-close?month=2026-10` answers 401 signed out;
   - the table exists;
   - the areas are closed for every department.
4. Tell chew:
   - where the page is;
   - that only management can use it until she gives Lock income and Unlock a step to people (Users and roles);
   - that Deductions, O2 and Final come in parts 2 and 3.

## As built (11 Nov 2026)

Branch `feat/owner-report-locks`. Tasks 1–9 as planned, with these differences, each also in the branch's ledger:

- **Migration 0302** starts with `set local search_path = pos; set local lock_timeout = '5s';` like 0258/0259. Without it PGlite could not find `units`.
- **Names.** The page, menu item and access area are named **Owner statement close** (the mockup said "Owner report close"). docs/VOCABULARY.md decision 6 puts "Owner statement" on screens, and the check enforces it. The page also says reservations (not bookings) and building (not property).
- **Code can ship before the migration.** `loadInputs` asks `to_regclass('owner_report_locks')` (`hasLocksTable`, remembered once true) and leaves the locks out until the table exists. Statements and the dashboard therefore keep working if the code is deployed before 0302 runs.
- **`syncLateIncome` writes once.** It works out every lock's difference first, then writes in **one transaction** under one advisory lock, with batched insert, update and delete, and one audit row per change. Audit label: "Late income update". The project's no-query-in-loop check refused one transaction per lock.
- **New helpers in ownerLocks.ts.** `incomeLockedMonths()` serves the reconciliation (its final months leave out income-locked months, so it posts no flat-% adjustment there). `incomeLockCounts()` serves the reconciliation banner.
- **Unlock** follows spec call 9 in full. Differences already on a final statement stay there, and the unlocked month gets a balancing owner adjustment ("Already settled on the November 2026 statement"). Unlocking a month whose own statement is final is refused.
- **API check** `scripts/api-checks/owner-close.mjs` (27 checks) picks a unit with free nights for its two fixture stays. It covers every Review Focus line.
- **Tests run locally** (fresh PGlite, CI order): late-bills, utility-listing, unit-pnl, yearly-report, airbnb-recon, owner-close and demo-mode all pass, except the lines that use the operations-staff test user `…0004`. The PGlite demo does not have that user; CI's seed does. rbac-matrix could not run locally (it needs its own database set-up), so its three new rows (`AFFFFFFU`) are checked by CI.
- **Pre-existing failures.** `npm test` has three failures that are already on main: categoryCatalog ×2, and statementPdf (an extensionless import).

Not done in part 1 (parts 2 and 3): Deductions and O2 locks; Make final gating; Unlock final with a Cancelled payout state; on the Overall owner report, the Locks column, the Agent/Company split and the agent % fill.
