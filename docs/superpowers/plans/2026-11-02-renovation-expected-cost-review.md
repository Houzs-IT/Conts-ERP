# Renovation Expected-Cost Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a renovation contract's cost runs over (or under) its budget, finance sees it, sets a new expected total cost or keeps the old one, and every decision is kept in a log they can filter and export. Completion % uses the new expected cost from the day it is set.

**Architecture:**
- A 30-minute sweep works out the cost alerts for every live contract and keeps them in `scm.reno_cost_alerts`.
- Finance (or HOD, by permission) answers an alert on the Renovation Projects page in one of two ways:
  - **Change**: writes a dated row to `scm.reno_expected_cost_changes`. `completionsAt` adds these changes to the expected cost from the lines, from their date onwards.
  - **Keep**: closes the alert.
- The sidebar shows a red count of open alerts.
- HOD email is built but off.

**Tech Stack:** Hono engine (`engine/backend`), PostgREST `sb`, vitest with `fakeSb`, React + TanStack Query (`engine/frontend`), Postgres migration in root `migrations-pg/`.

**Spec:** chew's answers in chat, 2026-11-02, and `docs/finance/FINANCE-SOP.md` 4.2.1, "实际和预计有差". Task 1 writes the answers into the SOP. Earlier plan: `docs/superpowers/plans/2026-10-31-renovation-completion-dashboard.md`.

## Global Constraints

**Alerts (chew 2026-11-02)**
- **Both levels raise an alert (C).**
  - **Line**: the purchase-order items linked to one contract line (`purchase_order_items.so_item_id`) against that line's `line_cost_sen`.
  - **Project**: cost spent plus ordered-not-billed against the expected total cost.
- **Threshold (B):** an alert is raised only when the gap is more than the larger of a fixed amount and a percentage of the budget.
  - Defaults: RM 500 (`50000` sen) and 5% (`500` bp).
  - Finance can change both per company.
  - The same rule applies to savings.

**Who acts**
- Finance acts on alerts. HOD may too: anyone with permission `scm.reno_estimate.change`.
- Finance is alerted only when there is something to act on: the sidebar's red count and the page's "Needs review" list. Finance gets no email.
- **HOD email is built but off:**
  - company setting `reno_alert_hod_notify` defaults to `false`;
  - the recipients are a finance-maintained list.

**How a change counts**
- It counts from the day it is saved, a Malaysian day (`todayMyt()`). Earlier months never change (SOP: 差额算在当月，不改以前的月份).
- It is stored as an adjustment on top of the lines' cost, so a later VO still moves the expected cost.
- A reason is required.

**Log and wording**
- The log shows one row per decision: project, date, by whom, reason, old, new, difference, what caused it. It can be filtered by date and project and exported to Excel.
- Screen text is British English; amounts are in RM on screen and in exports.

**Migrations**
- Root `migrations-pg/`, next free number (0192 as of 2026-11-02; check prod `public.pos_migrations` and all branches again before building).
- Never DROP.
- New tables get grants to `service_role` and `pos_app`.

## Review Focus

1. **Several POs for one line**:
   - Two POs of RM 5,000 against a RM 8,000 line make one line alert for RM 10,000, never two alerts.
   - Cancelled POs never count. Draft POs count from the day they are submitted.
2. **A decision is not undone by the next sweep**:
   - After "Keep" at RM 9,500, the next sweep must not reopen the alert.
   - It reopens only when the committed amount grows past the threshold above RM 9,500.
   - After "Change", the project alert clears because the expected cost has risen.
3. **Past months stay as they were**:
   - A change saved on 3 Dec leaves completion as at 30 Nov unchanged.
   - The performance P&L for November does not move.
4. **A contract that is handed over or cancelled** raises no new alerts. A change to its expected cost is refused with a sentence.
5. **The HOD switch off means no mail**:
   - with `reno_alert_hod_notify = false`, the sweep sends nothing even with recipients filled in;
   - with it on, each new alert is mailed once, never again on the next sweep.

---

### Task 1: SOP, migration and the expected cost in completion

**Files:**
- Modify: `docs/finance/FINANCE-SOP.md` (4.2.1 "实际和预计有差": the decisions above, dated 2026-11-02)
- Create: `migrations-pg/0192_reno_expected_cost_review.sql`
- Modify: `engine/backend/src/acc/reno-completion.ts` (`loadRenovationData`, `completionsAt`, header comment)
- Modify: `engine/backend/src/services/permissions.ts`, `engine/backend/src/conts/ledger-access.ts` (`full` list)
- Test: `engine/backend/tests/renoExpectedCost.test.ts`

**Migration contents:**
- `scm.reno_expected_cost_changes`:
  - `id bigserial`, `company_id int not null`, `so_doc_no text not null`, `effective_on date not null`;
  - `old_expected_sen bigint not null`, `new_expected_sen bigint not null`, `adjustment_sen bigint not null`;
  - `reason text not null check (length(trim(reason)) > 0)`;
  - `changed_by int`, `created_at timestamptz default now()`;
  - index `(company_id, so_doc_no, effective_on)`.
- `scm.reno_cost_alerts`:
  - `id bigserial`, `company_id int not null`, `so_doc_no text not null`;
  - `kind text check (kind in ('LINE_OVER','LINE_UNDER','PROJECT_OVER'))`, `so_item_id bigint null` (null for PROJECT_OVER);
  - `budget_sen bigint not null`, `committed_sen bigint not null`, `gap_sen bigint not null`;
  - `status text check (status in ('OPEN','CHANGED','KEPT','CLEARED')) default 'OPEN'`;
  - `raised_at timestamptz default now()`, `resolved_at timestamptz`, `resolved_by int`, `note text`;
  - `change_id bigint references scm.reno_expected_cost_changes(id)`, `hod_notified_at timestamptz`;
  - partial unique index on `(company_id, so_doc_no, kind, coalesce(so_item_id, 0)) where status = 'OPEN'`.
- `scm.acc_company_settings` add:
  - `reno_alert_min_sen bigint not null default 50000`;
  - `reno_alert_pct_bp int not null default 500`;
  - `reno_alert_hod_notify boolean not null default false`;
  - `reno_alert_hod_emails text not null default ''`.
- Grants on both tables and their sequences to `service_role`, `pos_app`.

**Interfaces:**
- Produces:
  - `RenovationData.adjustments: Array<{ doc: string; date: string; sen: number }>`;
  - `completionsAt` expected cost = Σ live line cost on or before `asOf` + Σ `adjustments` with `date <= asOf`;
  - `ContractCompletion.lineCostSen: number` (the lines alone, before adjustments; Task 3 needs it for `adjustment_sen`);
  - permission key `scm.reno_estimate.change` ("Change a renovation project's expected cost").

- [ ] **Step 1: Write the failing tests** in `renoExpectedCost.test.ts` using `fakeSb`, with a contract whose lines cost 6,500,000 sen (RM 65,000), cost to date 5,500,000, revised contract 10,000,000:
  - `expected cost takes a change from its day on`:
    - a change with `adjustment_sen: 1_000_000, effective_on: '2026-12-03'`;
    - `completionsAt(d,'2026-11-30')` → `expectedCostSen 6_500_000`, `pctBp 8462`;
    - `completionsAt(d,'2026-12-03')` → `expectedCostSen 7_500_000`, `pctBp 7333`, `lineCostSen 6_500_000`.
  - `a VO after a change still adds its cost`: add a line costing 200,000 dated 2026-12-10 → expected as at 12-10 is `7_700_000`.
  - `periodOf November is unchanged by a December change`: `periodOf(d,'2026-11-01','2026-11-30').earnedSen` is equal with and without the change row.
- [ ] **Step 2: Run** `npx vitest run tests/renoExpectedCost.test.ts` in `engine/backend`. Expected: FAIL (`adjustments` is not read).
- [ ] **Step 3: Implement**:
  - read `reno_expected_cost_changes` (`so_doc_no, effective_on, adjustment_sen`) through `inChunks` on `docs`, in the first `Promise.all` of `loadRenovationData`;
  - add the adjustments in `completionsAt`;
  - return `lineCostSen`;
  - update the header comment ("the HOD re-estimate comes later" → how changes count).
  - Also write the migration, the SOP paragraph and the permission entry.
- [ ] **Step 4: Run** the new test plus `tests/renoCompletion*.test.ts` and `tests/performancePnl*.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(renovation): expected cost changes count from their day (SOP 4.2.1)`.

### Task 2: The alerts and the sweep

**Files:**
- Create: `engine/backend/src/acc/reno-cost-alerts.ts`
- Modify: `engine/backend/src/index.ts` (the `*/30 * * * *` slot)
- Modify: `engine/backend/src/services/email.ts` (purpose `reno_cost_alert` → toggle key `email.reno_cost_alert`, internal, so not in `FAIL_CLOSED_PURPOSES`)
- Test: `engine/backend/tests/renoCostAlerts.test.ts`

**Interfaces:**
- Consumes: `renoProjectRows(sb, co, asOf)` for `expectedCostSen`, `costSpentSen`, `orderedNotBilledSen` and `status`; `todayMyt()`.
- Produces:
  - `thresholdSen(budgetSen: number, s: { minSen: number; pctBp: number }): number` = `max(minSen, round(|budgetSen| × pctBp / 10000))`.
  - `alertConditions(input): AlertCondition[]`, pure, where `AlertCondition = { soDocNo; kind; soItemId: number | null; budgetSen; committedSen; gapSen }`:
    - **LINE_OVER**: per live contract line with linked items, committed = Σ `line_total_sen` of items on POs not DRAFT/CANCELLED, when `committed − line_cost > threshold(line_cost)`.
    - **LINE_UNDER**: when the linked qty ≥ the line's qty and `line_cost − committed > threshold`.
    - **PROJECT_OVER**: when `costSpent + orderedNotBilled − expected > threshold(expected)`.
    - Contracts handed over or cancelled give none.
  - `sweepCostAlerts(sb, companyId, env?): Promise<{ raised: number; updated: number; cleared: number; mailed: number }>`:
    - an existing OPEN row with the same key gets its figures updated;
    - a condition with no OPEN row is inserted only if there is no CHANGED/KEPT row for the key, or the latest such row's `committed_sen` is exceeded by more than the threshold;
    - an OPEN row whose condition is gone becomes CLEARED;
    - new rows are mailed in one email to `reno_alert_hod_emails` only when `reno_alert_hod_notify` is true, and get `hod_notified_at`.
  - `sweepAllCostAlerts(env)`: every company, best-effort, logs `[cron reno-cost-alerts]`.

- [ ] **Step 1: Write the failing tests**:
  - `thresholdSen(800_000, defaults)` → `50_000`.
  - `thresholdSen(6_500_000, defaults)` → `325_000`.
  - `two POs on one line make one alert`: line cost 800,000; items 500,000 + 500,000 → one LINE_OVER with gap 200,000.
  - `a cancelled PO does not count`: one of the two POs CANCELLED → none.
  - `inside the threshold is quiet`: committed 840,000 → none. Committed 860,000 → LINE_OVER.
  - `saving needs the line fully ordered`: items 600,000 for qty 1 of 2 → none; for qty 2 → LINE_UNDER, gap 200,000.
  - `project over`: expected 6,500,000, spent 5,000,000, ordered 1,800,000 → none (gap 300,000 ≤ 325,000). Ordered 1,900,000 → PROJECT_OVER.
  - `a kept alert stays kept`: sweep, mark KEPT at committed 950,000, sweep again → no OPEN. Committed 1,010,000 → a new OPEN.
  - `a gone condition clears`: OPEN, then the PO is cancelled → CLEARED.
  - `HOD mail off by default`: recipients set, switch off → `mailed 0`, `sendEmail` not called. Switch on → `mailed 1`; a second sweep → still one call in total.
- [ ] **Step 2: Run** `npx vitest run tests/renoCostAlerts.test.ts`. Expected: FAIL (the module does not exist).
- [ ] **Step 3: Implement** `reno-cost-alerts.ts`:
  - reads are chunked: contract lines `mfg_sales_order_items (id, doc_no, qty, line_cost_sen, cancelled)`, `purchase_order_items (purchase_order_id, so_item_id, qty, line_total_sen)` by `so_item_id`, then `purchase_orders (id, status)`;
  - wire the cron slot and the email purpose.
- [ ] **Step 4: Run** the test file, then `npx tsc -b`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(renovation): cost alerts on lines and projects, swept every 30 minutes`.

### Task 3: Routes

**Files:**
- Create: `engine/backend/src/acc/reno-cost-review-routes.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts` (mount next to `/reno-projects`)
- Modify: the route-count pins (179/188 today, +5 each; find them with `grep -rn "188" engine/backend/tests/*route*`)
- Test: `engine/backend/tests/renoCostReviewRoutes.test.ts`

**Routes (under `/accounting`, behind the Ledger guard):**
- `GET /reno-cost-alerts?status=OPEN|ALL` → `{ alerts: Array<alert row + projectName> }`.
- `GET /reno-cost-alerts/pending-count` → `{ count }` (OPEN rows, the company only).
- `POST /reno-projects/:soDocNo/expected-cost { newExpectedSen, reason }`:
  - needs `scm.reno_estimate.change`;
  - takes `old` from `completionsAt(today)`, then `adjustment_sen = newExpectedSen − lineCostSen − (Σ earlier adjustments)`;
  - inserts the change and sets every OPEN alert of the contract to CHANGED with the `change_id`;
  - refusals: `not_found`, `closed` ("This project is handed over or cancelled; its expected cost can no longer change."), `bad_amount` (must be a positive whole number of sen), `reason_required`.
- `POST /reno-cost-alerts/:id/keep { note }`: needs the same permission; sets KEPT with the note (required). An alert that is not OPEN → 409 `not_open`.
- `GET /reno-expected-cost-log?from&to&soDocNo`:
  - one row per change (outcome `Changed`) and per KEPT alert (outcome `Kept`), newest first;
  - each row: project name, date, user name, reason/note, old, new, difference, and the cause: the alert kind plus the PO numbers for a line alert, or "Manual" for a change with no alert.

- [ ] **Step 1: Write the failing tests**:
  - change: old 6,500,000 → new 7,500,000; the change row has adjustment 1,000,000, both OPEN alerts are CHANGED, and the log shows one `Changed` row with difference 1,000,000;
  - a second change to 7,000,000 stores adjustment −500,000;
  - refusals: no permission → 403; empty reason; amount `0` or `"abc"`; handed-over contract → `closed`;
  - keep: sets KEPT; a second keep → 409;
  - pending-count counts OPEN of the active company only.
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and mount them; update the route-count pins.
- [ ] **Step 4: Run** the test file, `tests/routeManifest*.test.ts` (its three `/beta` failures are pre-existing on main) and `npx tsc -b`. Expected: PASS apart from the known three.
- [ ] **Step 5: Commit** `feat(renovation): change or keep the expected cost, with a log`.

### Task 4: Screens

**Files:**
- Modify: `engine/frontend/src/conts/renoProjectsQueries.ts`: the alert, log and settings types and hooks; `useChangeExpectedCost`, `useKeepAlert` invalidate `conts-reno-projects`, `conts-reno-alerts`, `conts-reno-log` and the badge key.
- Modify: `engine/frontend/src/conts/RenoProjects.tsx`:
  - tabs **Projects | Needs review (n) | Changes**;
  - a row action "Change expected cost" on the Projects table;
  - a settings panel.
- Create: `engine/frontend/src/conts/ExpectedCostDialog.tsx`.
- Modify: `engine/frontend/src/hooks/useAmendmentApprovals.ts`: badge source `"reno-cost-alerts"` → `/api/scm/accounting/reno-cost-alerts/pending-count`, polled every 5 minutes.
- Modify: `engine/frontend/src/components/Sidebar.tsx`: `badge: "reno-cost-alerts"` on Renovation Projects.
- Modify: the backend settings route that saves `acc_company_settings` for e-invoice, or a small `GET/PUT /accounting/reno-alert-settings` in Task 3's file if that route is e-invoice-only. Save the four columns; a percentage ≤ 100; emails checked by `recipientList`.

**Screen text (exact):**
- Needs review columns: Project, What, Budget, Committed, Gap, Raised, and the actions **Change expected cost** / **Keep**.
- The **What** column reads:
  - "Line over budget: {line description}";
  - "Line under budget: {line description}";
  - "Project cost over the expected cost".
- Dialog, title "Change expected cost":
  - it shows Current expected cost, Cost spent, Ordered, not billed;
  - fields **New expected cost (RM)** and **Reason**.
  - When the new figure is below the cost spent, a warning: "Below the cost already spent: completion will stay at 99% until handover."
- Keep dialog: field **Why keep it** (required).
- Changes tab: DataTable `tableId="conts-reno-cost-log"`, export `renovation-expected-cost-changes`, columns Date, Project, Outcome, Old (RM), New (RM), Difference (RM), Cause, Reason, By. Filters: date range, project search.
- Settings panel, "Alert settings":
  - **Alert when over by more than RM** [500], **or %** [5], whichever is larger;
  - **Email HOD about new alerts** (off);
  - **HOD email addresses**.
- Only users with `scm.reno_estimate.change` see the action buttons. Everyone with page access sees the lists.

- [ ] **Step 1: Write the failing tests** in `engine/frontend/src/conts/renoProjectsQueries.test.ts`:
  - `alertLabel` for each kind gives the exact text above;
  - `logRowsForExport` gives RM numbers (`/100`);
  - the dialog's `belowSpent(newSen, spentSen)` returns true when below.
- [ ] **Step 2: Run** `npx vitest run src/conts/renoProjectsQueries.test.ts` in `engine/frontend`. Expected: FAIL.
- [ ] **Step 3: Implement** the screens.
- [ ] **Step 4: Run** the tests and `npx tsc -b` in `engine/frontend`. Then open `/scm/reno-projects` in the preview:
  - the tabs, the badge and the dialog render in light and dark mode at phone width;
  - change a test contract's expected cost and see the log row.
- [ ] **Step 5: Commit** `feat(renovation): Needs review, the change log and alert settings on Renovation Projects`.

### Task 5: Ship

- [ ] Run the whole backend suite in the background and compare its failures with main's known list: routeManifestDrift `/beta` ×3, doStockLeavesOnConfirm, renovationRecords, soLineFreezeRoutes, and the load-flaky opening/journalClasses/specialsRecorded.
- [ ] Get a fresh opus reviewer on the branch diff against this plan. Fix its findings test-first.
- [ ] Apply `0192` on production in one transaction with its `public.pos_migrations` row: checksum = first 16 hex of the sha256 of the LF-normalised file. Check `pg_stat_activity` first for long transactions on `scm.acc_company_settings`.
- [ ] Open the PR, merge with `gh pr merge --merge`, and watch the deploy with `scratchpad/wait-deploy.sh <sha>`.
- [ ] Run `sweepCostAlerts` once on production through the cron. Check `scm.reno_cost_alerts` for sensible rows against the 7 live project POs, and tell chew what came up.
