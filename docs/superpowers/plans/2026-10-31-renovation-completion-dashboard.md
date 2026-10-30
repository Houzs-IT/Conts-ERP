# Renovation completion % for management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show management, per renovation project, how far the work really is. Completion % = booked cost ÷ expected total cost, and earned revenue = completion % × contract. It is compared with what was invoiced (the books). It appears in the performance P&L and a new project status table (SOP 4.2.3). It is never posted.

**Architecture:**
- **Cost is tagged with its project.** Cost postings now stamp the project on their cost lines (`scm.journal_entry_lines.project_id` exists but nothing fills it), so "booked cost" is read straight from the ledger.
- **One module for the numbers.** `acc/reno-completion.ts` computes each contract's expected total cost, cost to date, completion % and earned revenue as at any date. The performance P&L and the project status table both read it.
- **Renovation in the performance P&L.** Renovation orders leave the sales-order side of the performance P&L and get their own block: earned revenue for the period, and the project cost booked in the period.

**Tech Stack:** Hono engine (`engine/backend`), PostgREST `sb`, vitest, React + TanStack Query + the project's `DataTable` (`engine/frontend`).

**Spec:**
- `docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md` goal 8 and section 8;
- SOP `docs/finance/FINANCE-SOP.md` 4.2.1 (completion %, 99% cap, the example), 4.2.2, 4.2.3 (the table).

## Global Constraints

- **Management only.** Nothing in this plan posts a journal. Earned revenue lives on screens and in the performance P&L, never in the books.
- **Completion %:**
  - completion % = cost to date ÷ expected total cost;
  - it is capped at **99%** until the contract is `RENO_COMPLETED` (handed over), then it is 100%;
  - with expected total cost 0, completion is 0% before handover and 100% at handover.
- **Earned revenue:** earned to date = completion % × revised contract (contract + VOs − contract credits), rounded to sen.
  - Earned in a period = earned at the period's last day − earned at the day before its first day.
  - Earned revenue is computed from the date's numbers; past months are never rewritten.
- **Cost to date:** journal lines on an EXPENSE account carrying the contract's `project_id`, debit − credit, entry date ≤ as-of, reversed entries excluded. Plus, for a contract signed before the ledger start, its go-live cost baseline (Task 4).
- **Expected total cost:** the sum of `line_cost_sen` over the contract's live SO lines (not cancelled; VO lines included; RENO-CREDIT / RENO-DISCOUNT rows carry no cost). It is kept simple per spec section 8; the HOD re-estimate flow is later.
- **Text:** product text in English (British). Money in RM with 2 decimals in tables. Percentages to 1 decimal.
- **Schema and release:**
  - new columns use `add column if not exists`, never DROP;
  - the next free migration number is checked on production and every branch;
  - run `npx tsc -b` in `engine/backend` and `engine/frontend` before merging.
- **Public tables:** `public.projects` is read through `sb.schema('public')`.

## Review Focus

1. **A reversed cost** (a cancelled purchase invoice). Its contra must cancel the cost for the project, and the reversal must carry the project too. Pinned in Task 1: `a reversal keeps the project on its lines`.
2. **A contract signed before go-live with no cost baseline yet.** Its completion % is understated, so the row is flagged "Cost before go-live not entered" and is never silently shown as low progress. Pinned in Task 4: `old contract without baseline is flagged`.
3. **Cost above the expected total.** The percentage stays capped at 99% (100% at handover) and the row turns red "Over budget". It never shows 140%. Pinned in Task 3: `cost over expected caps at 99 and flags over budget`.
4. **A month with a VO that raises the contract.** Earned revenue for the month uses the revised contract at the month's end, so the difference lands in that month. Pinned in Task 3: `VO in the month moves earned in that month only`.
5. **A cost line on a non-renovation project** (rental, internal). It must not enter any contract's cost, and it must stay in the performance P&L's ordinary expenses. Pinned in Task 5: `non-renovation project cost stays in other expenses`.

---

## PR plan

| PR | Tasks | Holds |
|---|---|---|
| 1 | 1, 2 | Project on cost lines: engine and every cost posting path |
| 2 | 3, 4, 5 | Completion module, go-live cost baseline, performance P&L block |
| 3 | 6, 7 | Project status table: route and page; SOP note |

---

### Task 1: The engine carries a line's project

**Files:**
- Modify: `engine/backend/src/acc/engine.ts`:
  - the line type and insert (around line 310), which add `projectId?: number | null`;
  - the reversal read and contra lines (around lines 435–515), which copy `project_id`.
- Create: `migrations-pg/0188_journal_line_project_index.sql`, holding `create index if not exists journal_entry_lines_project on scm.journal_entry_lines (company_id, project_id) where project_id is not null;`.
- Test: `engine/backend/src/acc/engine.test.ts`

**Interfaces:**
- Produces: `PostJournalLine.projectId?: number | null`, stored as `journal_entry_lines.project_id`. A reversal keeps it.

- [ ] **Step 1: Write the failing tests.**
  - `a line's project is stored`: post with one line `projectId: 7`; its row has `project_id: 7` and the other line has `null`.
  - `a reversal keeps the project on its lines`: reverse it; the contra line on the same account has `project_id: 7`.
- [ ] **Step 2: Run them to see them fail.** `cd engine/backend && npx vitest run --config vitest.light.config.mts src/acc/engine.test.ts`
- [ ] **Step 3: Implement.** A non-integer `projectId` refuses the posting with `bad_line`, the way an unknown department does.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(ledger): journal lines carry their project`

### Task 2: Every cost posting stamps its project

**Files:**
- Modify:
  - `engine/backend/src/scm/routes/accounting.ts`: the PI postings at about lines 983 and 1086. The project comes from the PI's purchase order, else its GRN (`purchase_orders.project_id`, `grns.project_id`).
  - `engine/backend/src/scm/routes/ap-invoices.ts`: the API postings at about lines 331–410. Each expense line takes its `ap_invoice_lines.project_id`.
  - `engine/backend/src/scm/routes/payment-vouchers.ts`: the PV postings at about lines 1164 and 2121. A direct-expense line takes its `payment_voucher_lines.project_id`. Lines that settle a bill carry none, because the bill already carried the cost.
  - `engine/backend/src/conts/petty-cash-ledger.ts`: CLM and CLW. Each expense line takes its `staff_receipt_lines.project_id`.
  - `engine/backend/src/acc/credit-notes.ts`: a supplier credit note (SCN) whose source is a project's PI takes that PI's project on its cost line.
- Test: the existing test file beside each (`accounting` PI posting tests, `ap-invoices`, `payment-vouchers`, `petty-cash-ledger.test.ts`, `credit-notes`).

**Interfaces:**
- Consumes: Task 1's `projectId`.
- Produces:
  - `export async function projectOfPurchaseInvoice(sb: Db, companyId: number, pi: { purchase_order_id: string | null; grn_id: string | null }): Promise<number | null>` in `conts/project-limit.ts`, beside `projectOfBills`.
  - Only lines on EXPENSE-type accounts get the project. Control, bank and tax lines stay null.

- [ ] **Step 1: Write the failing tests**, one per path:
  - `PI for a project's PO stamps the project on its cost lines`;
  - `AP invoice line project lands on its expense line`;
  - `PV direct expense keeps its line's project; a bill settlement line has none`;
  - `petty cash claim line project lands on the ledger`;
  - `SCN against a project PI gives back cost to that project`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass,** along with each file's existing tests.
- [ ] **Step 5: Commit.** `feat(ledger): cost postings stamp their project`

**PR 1:** apply 0188 on production, run a fresh review, then merge and watch the deploy. Ledger posting starts on 1 Nov 2026, so there is nothing to backfill unless lines exist by then. If there are, add a one-off backfill SQL per path to the PR and run it.

---

### Task 3: Completion module

**Files:**
- Create: `engine/backend/src/acc/reno-completion.ts`
- Test: `engine/backend/src/acc/reno-completion.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CompletionInput {
    revisedContractSen: number; expectedCostSen: number; costToDateSen: number; handedOver: boolean;
  }
  export interface Completion {
    pctBp: number;            // 0..10000, capped 9900 before handover
    earnedSen: number;        // pctBp × revisedContract, rounded
    overBudget: boolean;      // costToDate > expectedCost
    lossExpected: boolean;    // expectedCost > revisedContract
  }
  export function completionOf(i: CompletionInput): Completion;   // pure

  export interface ContractCompletion extends Completion {
    soDocNo: string; projectId: number | null; asOf: string;
    revisedContractSen: number; expectedCostSen: number; costToDateSen: number; invoicedSen: number;
    differenceSen: number;    // invoiced − earned (positive = invoiced ahead of the work)
    goliveCostMissing: boolean;
  }
  export async function contractCompletions(sb: Db, companyId: number, asOf: string, soDocNos?: string[]): Promise<ContractCompletion[]>;
  ```
- Sources:
  - **Contracts:** `reno_so_contracts` joined with `mfg_sales_orders` (status, `project_id`), live statuses plus CANCELLED, which earns nothing after cancel.
  - **Revised contract as at the date:** live SO lines with `line_date` ≤ asOf, using the same rows `billingView` sums.
  - **Expected cost:** the same lines' `line_cost_sen`.
  - **Cost to date:** journal lines with `project_id`, via `v_gl_entries` or `journal_entry_lines` + `journal_entries` (posted, not reversed, `entry_date ≤ asOf`), on EXPENSE accounts, plus `golive_cost_sen` (Task 4).
  - **Invoiced:** `netBilledSql`'s rule (issued invoices dated ≤ asOf + billed before go-live − contract credits − negative instalments).

- [ ] **Step 1: Write the failing tests** (pure `completionOf` first, then `contractCompletions` on a `fakeSb` world):
  - `SOP example month by month`: contract 100,000 and expected cost 65,000, with cumulative cost of 0, 20,000, 55,000 and 65,000 (handed over in Dec). Earned is 0, 30,769.23, 84,615.38 and 100,000. The percentages are 0, 3077, 8462 and 10000.
  - `cost over expected caps at 99 and flags over budget`: cost 70,000 against expected 65,000 before handover gives 9900 and overBudget true.
  - `zero expected cost is 0 before handover and 100 at handover`.
  - `VO in the month moves earned in that month only`: a VO line dated 2026-11-15 adds 10,000 sell and 6,000 cost. As of 2026-10-31 the result is unchanged; as of 2026-11-30 it uses 110,000 and 71,000.
  - `a reversed cost does not count`.
  - `difference is invoiced minus earned`.
  - `loss expected when expected cost exceeds the contract`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Earned uses the exact ratio, not the rounded percentage: `earned = Math.round(revised × min(cost / expected, cap))`, where the cap is 0.99 before handover and 1 at handover. `pctBp = Math.round(min(cost / expected, cap) × 10000)` is for display only. Rounding through basis points would turn the SOP's October figure, 30,769.23, into 30,770.00.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(reno): completion % and earned revenue (management only)`

### Task 4: Go-live cost baseline

**Files:**
- Create: `migrations-pg/0189_reno_golive_cost.sql`, holding `alter table scm.reno_so_contracts add column if not exists golive_cost_sen bigint;`.
- Modify: `engine/backend/src/acc/reno-opening.ts` and `engine/frontend/src/conts/RenovationOpening.tsx`. The old-contracts upload gets an optional column "Cost before go-live (RM)".
- Test: `reno-opening` tests, `RenovationOpening.test.tsx`, `reno-completion.test.ts`

**Interfaces:**
- Produces: `golive_cost_sen` is read by `contractCompletions` and added to cost to date. `goliveCostMissing = signed before ledger start && golive_cost_sen is null`.

- [ ] **Step 1: Write the failing tests:**
  - `upload stores cost before go-live`;
  - `a blank cost column leaves it null`;
  - `old contract without baseline is flagged`;
  - `baseline adds to cost to date`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** The preview table shows the new column. Re-uploading a row overwrites it, the same way the billed-before-go-live amount does.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(reno): cost before go-live for old contracts`

### Task 5: Renovation block in the performance P&L

**Files:**
- Modify: `engine/backend/src/acc/performance-pnl.ts`:
  - `buildPerformanceReport` gains a `renovation` input and output;
  - the loader leaves `so_kind = 'RENOVATION'` orders out of the sales-order side;
  - EXPENSE lines carrying a renovation contract's project leave `otherExpenses` and become the block's cost.
- Modify: `engine/frontend/src/pages/scm-v2/PerformancePnl.tsx` (the block, above other income).
- Test: `engine/backend/src/acc/performance-pnl.test.ts` (or the existing contract test), `PerformancePnl.test.tsx`

**Interfaces:**
- Produces, on `PerformanceReport`:
  ```ts
  renovation: {
    earnedSen: number;     // Σ earned(to) − earned(from − 1 day) over contracts
    costSen: number;       // project-tagged cost booked in the period on renovation contracts
    gpSen: number; gpPct: number | null;
    invoicedSen: number;   // what the books show for the same contracts in the period (memo)
    differenceSen: number; // invoiced − earned (memo)
    contracts: number;
  }
  ```
- Totals: `totals.salesSen` includes `earnedSen`; `cogsSen` includes `costSen`. Net is computed as before.
- The page labels the block "Renovation (by completion — not in the books)" and shows "Invoiced (books)" and "Difference" as memo lines.

- [ ] **Step 1: Write the failing tests:**
  - `renovation orders leave the sales-order side`;
  - `earned and cost for the month come from completion`. Use the SOP's November figures: earned 53,846.15 and cost 35,000.
  - `non-renovation project cost stays in other expenses`;
  - the page test: `renovation block shows earned, cost, GP and the memo lines`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(reno): renovation by completion in the performance P&L`

**PR 2:** apply 0189 on production, run a fresh review, then merge and watch the deploy.

---

### Task 6: Project status route

**Files:**
- Create: `engine/backend/src/acc/reno-projects.ts` and `reno-projects.test.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts`, which mounts `GET /accounting/reno-projects?asOf=`.

**Interfaces:**
- Produces one row per contract (live, plus completed in the last 12 months), in SOP 4.2.3's columns:
  ```ts
  export interface RenoProjectRow {
    soDocNo: string; projectId: number | null; projectName: string; customerCode: string | null; customerName: string;
    salesperson: string | null; brand: string | null; kind: 'RENOVATION' | 'INHOUSE_RENOVATION'; status: string;
    handoverDate: string | null; delayed: boolean;
    contractSen: number; voSen: number; revisedContractSen: number;
    receivedSen: number; outstandingSen: number; collectedBp: number | null;
    nextInstalment: { seq: number; label: string; amountSen: number; trigger: string } | null;
    gapsByInvoiceDays: Array<number | null>; gapsByPaymentDays: Array<number | null>;   // 1→2, 2→3, 3→4
    invoicedSen: number; advanceLeftSen: number; completionBp: number; earnedSen: number; differenceSen: number;
    expectedCostSen: number; costSpentSen: number; orderedNotBilledSen: number; remainingCostSen: number; owedToSuppliersSen: number;
    overBudget: boolean; lossExpected: boolean; goliveCostMissing: boolean;
    expectedGpBp: number | null; gpToDateBp: number | null;
    limit: { limitSen: number; usedSen: number; leftSen: number } | null;
    workAheadOfMoney: boolean;   // completionBp − collectedBp ≥ 2000
  }
  export async function renoProjectRows(sb: Db, companyId: number, asOf: string): Promise<RenoProjectRow[]>;
  ```
- Sources, reusing what exists:
  - completion: `contractCompletions` (Task 3);
  - billing and next instalment: `billingViews`;
  - received: confirmed payments per SO (`acc/receipts` `confirmedPaymentIds`, as the project limit uses);
  - project limit: `projectLimit`;
  - project name: `public.projects` via `sb.schema('public')`;
  - advance left: the advance sub-account's ledger balance;
  - ordered not billed: the project's PO lines not yet on a purchase invoice;
  - owed to suppliers: unpaid PI and AP balances for the project.
- Payment gaps: the date cumulative confirmed receipts first covered each instalment's cumulative invoiced amount; days between those dates.

- [ ] **Step 1: Write the failing tests:**
  - `a row has the SOP 4.2.3 numbers for the example contract`. Check each money column, `collectedBp`, `completionBp` and both GP percentages.
  - `work ahead of money is flagged at 20 points`;
  - `gaps by invoice and by payment`;
  - `old contract without baseline is flagged`, as passed through from Task 4;
  - `another company's contracts are not listed`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Reads go in parallel per source, never one per contract.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(reno): project status rows`

### Task 7: Project status page

**Files:**
- Create: `engine/frontend/src/conts/RenoProjects.tsx`, `renoProjectsQueries.ts` and `RenoProjects.test.tsx`
- Modify: `App.tsx` (route `/scm/reno-projects`), `components/Sidebar.tsx` (Finance, beside E-invoice), `routing/routeManifest.ts` and the route-count pins in `routing/routeManifestDrift.test.ts`.
- Modify: `docs/finance/FINANCE-SOP.md` 4.2.3, with one line naming the page and the 20-point rule.

**Layout** (dashboard-design; reuse `DataTable`, its column picker and saved layouts, `tableId="conts-reno-projects"`):
- **Header:** "Renovation projects", an as-of date picker (default today), and the note "Completion revenue is for management; the books follow the invoices."
- **KPI row** (4 cards):
  - revised contracts;
  - invoiced (books);
  - earned by completion, compared with invoiced as "▲/▼ RM x vs invoiced";
  - projects over budget, red when above 0.
- **Table:** every RenoProjectRow field as a column, grouped as in SOP 4.2.3.
  - Default visible columns: Project, Customer, Status, Revised contract, Received, Collected %, Completion %, Earned, Invoiced, Difference, Cost spent, Expected cost, GP to date %, Alerts.
  - Money columns are right-aligned, tabular, in RM with 2 decimals; percentages have 1 decimal.
- **Alerts column, as text chips:**
  - "Over budget";
  - "Loss expected";
  - "Work ahead of money";
  - "Cost before go-live not entered";
  - "Delayed".
- **States:** loading, empty ("No renovation contracts yet") and error.

- [ ] **Step 1: Write the failing tests:**
  - `KPI row sums the rows`;
  - `alerts show as text`;
  - `as-of date refetches`;
  - `money is right-aligned in RM`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass,** with `npx tsc -b` in both packages.
- [ ] **Step 5: Commit.** `feat(reno): project status page`

**PR 3:** run a fresh review, then merge and watch the deploy.

---

## Calls made in this plan (check them)

- **Booked cost comes from the ledger.** Cost postings now carry their project. Payments and supplier deposits don't count; only the expense entries do (SOP 4.2.1).
- **Expected total cost** is the order lines' cost plus VOs. The HOD re-estimate and alert flow (SOP 4.2.1, "实际和预计有差") is not in this plan.
- **The 99% cap** before handover is in, from SOP 4.2.1. "Handed over" means status `RENO_COMPLETED`.
- **"Work ahead of money"** is flagged when completion % exceeds collected % by 20 points or more. It is a constant, not a setting.
- **Old contracts need their cost before go-live** to show the right completion %. It is an optional column on the go-live upload; until it is filled, such rows are flagged.
- **Performance P&L for renovation** shows earned revenue, not invoiced revenue. Invoiced revenue and the difference are memo lines on the same block.
