# Utility Bill Scan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finance scans a month of utility bills (PDFs or photos) on the Utility bills screen, checks one table and records them all. Recording also:
- splits a bill whose printed period crosses a contract's start or end by days;
- gives an owner back a bill they paid themselves (O2);
- sends finance one payment request per provider for the bills the company pays.

**Architecture:**
- **Property OS** owns the bills: utility accounts, expenses, owner adjustments and statements.
  - Pages are uploaded as `receipt` documents.
  - `POST /api/expenses/utilities/scan` sends each page to the engine to be read, then matches it to a unit locally.
  - `POST /api/expenses/utilities/scan/record` saves the checked rows through today's utility save rules, plus the split, the O2 lines and the account marks.
- **The engine** reads (it already holds the Anthropic key and the vision helpers in `scm/lib/scan-ocr.ts`) and keeps payment requests.
  - Two new paths on the existing claims forward (`/api/claims-forward/utility-bills/*`): `read` and `payment-request`.
  - Property OS reaches them with `forwardClaims` (`functions/_lib/claimsForward.ts`).
  - **No Cloudflare key for chew to set.** This replaces Task 8's Pages-side SDK call in the 27 Oct plan.

**Tech Stack:** Property OS React + Pages Functions + Postgres (`pos`); engine Hono + vitest; Claude Haiku 5.5 / Sonnet 5.5.

**Spec:**
- `docs/superpowers/specs/2026-10-27-utility-bills-design.md` §5 (flow, reading, matching, guards) and the 28 Oct split decision in `docs/finance/FINANCE-SOP.md` §3.10.
- chew's decisions of 2 Nov 2026, below. This plan replaces Piece 3 (Tasks 7–11) of `docs/superpowers/plans/2026-10-27-utility-bills.md`.

## Global Constraints

**Decisions of 2 Nov 2026 (chew)**
- **Owner paid.** Each row has a tick, "Owner paid this bill". Unticked means the company pays the provider.
  - A ticked bill is recorded as usual (shared by the split) **and** the full amount goes back to the owner as an O2 line: `owner_adjustments` kind `credit`, positive.
  - chew's example: RM 100, 80/20 split. The owner bears RM 80 through the split and gets RM 100 back.
- **Payment request.** Bills not ticked go to finance as **one payment request per provider per scan**, with a list of every bill's unit, account number and amount. chew chose A.
- **Split by contract days, built now** (chew: A). The printed period decides, counted in days, both ends included.
  - Days before the contract starts, or after it ends, are the owner's alone: `owner_adjustments` kind `charge`, negative, taken after the split.
  - Days inside the contract follow the contract as today: Package A/B/D are shared; GRR (Package C) is borne by the company, as the statement engine already does.
  - SOP example: RM 310, 15/08–14/09 (31 days), contract from 11/09, 80/20 → RM 270 owner alone, RM 40 shared (owner RM 32, company RM 8).
- **Everything can be changed by hand.** Before "Record bills", every field of every row can be edited: kind, bill month, period from/to, amount, unit, the tick. The split preview follows the edits. After recording, bills are edited and deleted on the Utility bills screen as today.

**Earlier decisions (spec §5, 27 Oct)**
- **Models.** Haiku 5.5 first. Sonnet 5.5 again when the read has no amount or no month, matches red, or fails the ±50 % guard.
  - Both ids live in one constant: `UTILITY_READ_MODELS = { first: 'claude-haiku-5-5', retry: 'claude-sonnet-5-5' }`.
  - No reading time limit.
- **Matching** follows spec §5.3. **Guards** follow §5.4: "Already recorded" is unticked; ±50 % of the last three bills is amber; unreadable is red.
- **Copy:** "Scan bills", "Reading page 12 of 40", "Record 37 bills", "Already recorded", "Pick the unit", "Owner paid this bill".

**My calls (chew can overrule when reading)**
- **A bill wholly outside the contract.** It is kept as a `record_only` expense, so it shows on the listing and blocks a second scan. The whole amount is an owner `charge`.
- **No contract on any day of the period.** No split; the whole bill goes to the chosen payer as today.
- **Two contracts in one period** (owner changed mid-bill). The row is amber, "Two contracts in this period: split by hand", and is not split.
- **Rounding.** Owner-alone sen = round(amount × outside days ÷ total days); the shared part is the rest.
- **Payee.** The payment request is made out to the engine supplier whose name matches the provider (TNB, Indah Water, TIME, Maxis…) when one exists. Otherwise it uses `payee_name` = provider with `payee_to_check`. Today none of these suppliers exist in the engine; finance can add them.
  - Lines: department `rental`, one line per bill with its `unit_id`, description "<Kind> <bill month> <account no.>", no account (finance sets it on the voucher).
  - Files: the PDFs or photos as picked, up to the claims limit (8 files, 25 MB). Larger scans attach only the list, and the request note says the pages are on the Utility bills screen.
- **Adjustment links.** An owner adjustment made by a scan carries the expense it came from (`owner_adjustments.expense_id`, new). Deleting that expense also deletes its open adjustments. It is refused once an adjustment is no longer `open`.

## Review Focus

1. **A bill already recorded is never recorded twice.** This covers a rescan of the same PDF, the same page scanned in two batches, and two people recording at once. The unique check must hold in the save transaction, not only in the review table.
2. **The split, the O2 credit and the payment request agree with the money.**
   - Expense + owner charge = the bill.
   - A ticked bill is in no payment request.
   - The request total = the sum of the unticked bills recorded in that scan.
   - A failed record leaves no request; a failed request leaves the bills recorded and offers "Send to finance again".
3. **A hand edit wins.** A period, unit or amount changed by hand is what is saved and what the split uses. The model's figures are never re-applied.
4. **A weak clue is never green.** Building or owner name alone stays amber (spec §5.3). A single strong clue shared by two accounts is amber and lists both.
5. **Slow or failing pages.** One page that takes minutes or fails does not block the others. "Stop" cancels only the unfinished pages. A page the engine could not read is red with empty figures, never RM 0.00.

---

### Task 1: Engine — read one utility page, Haiku then Sonnet

**Files:**
- Create: `engine/backend/src/acc/utility-bill-read.ts`, `engine/backend/src/acc/utility-bill-read.test.ts`
- Modify: `engine/backend/src/conts/my-claims-routes.ts` (route `POST /utility-bills/read`), its test file

**Interfaces:**
- Produces: `UTILITY_READ_MODELS`.
- Produces: `type UtilityRead`, with the spec §5.2 fields in sen and `null` when absent: `kind`, `provider`, `billMonth`, `periodFrom`, `periodTo`, `amountDueSen`, `currentChargesSen`, `accountNoVisible`, `accountNoFull`, `depositSen`, `invoiceNo`, `premiseAddress`, `buildingName`, `unitText`, `ownerName`, `meterPrevious`, `meterCurrent`, `confidenceNotes`.
- Produces: `coerceUtilityRead(raw: unknown): UtilityRead`, which turns "RM 1,311.18" into 131118, keeps masks as `X` and accepts only ISO dates.
- Produces: `needsRetry(r: UtilityRead): boolean`, true when there is no amount or no bill month.
- Produces: `readUtilityPage(key: string, file: { mime: string; dataBase64: string }, opts?: { retry?: boolean }): Promise<{ read: UtilityRead; model: string } | { error: string }>`. It uses `anthropicFetchWithRetry` from `scm/lib/scan-ocr.ts` with structured output (`output_config.format`, a JSON schema) and effort low. Read the claude-api skill's cURL/TypeScript notes for the exact request shape first.
- Produces (HTTP, forward only, office staff): `POST /utility-bills/read` with body `{ file: {name,mime,dataBase64}, retry?: boolean }` → `{ read, model }`. Without the key it answers 503 `SCAN_NOT_SET_UP`.

- [ ] **Step 1: Failing tests** (fetch stubbed):
  - "RM 1,311.18" → 131118;
  - "2104010945XX02" is kept;
  - a missing amount → `needsRetry` is true;
  - `retry: true` sends `claude-sonnet-5-5`, otherwise `claude-haiku-5-5`;
  - an unreadable answer → `{ error }`, never an amount of 0;
  - a field login gets 403 on the route.
- [ ] **Step 2:** Run `npx vitest run --config vitest.light.config.mts src/acc/utility-bill-read.test.ts`. Expect FAIL; implement; expect PASS.
- [ ] **Step 3: Commit** `feat(utilities): the engine reads a utility bill page`.

### Task 2: Engine — one payment request for a provider's bills

**Files:**
- Modify: `engine/backend/src/conts/payment-request-routes.ts` (export the insert used by `/requests` if it is not exported) and `my-claims-routes.ts` (route `POST /utility-bills/payment-request`, multipart like `/requests`), with tests.

**Interfaces:**
- Produces (HTTP, forward only, office staff): `POST /utility-bills/payment-request`.
  - `data = { provider: string, scanBatchId: string, note?: string, bills: { unitId: string; kind: string; billMonth: string; accountNo: string | null; amountSen: number }[] }` plus 0–8 files.
  - Returns `{ requestNo, amountSen }`.
  - It makes one PAYMENT request, with the supplier matched by name or else `payee_name` + `payee_to_check`, and one `rental` line per bill.
  - It is idempotent on `scanBatchId` + provider: a second call returns the first request.

- [ ] **Step 1: Failing tests:**
  - three bills → one request; total = the sum; three lines with their unit; no account on the lines;
  - a supplier named "TNB" exists → `supplier_id` is set; none exists → payee "TNB" to check;
  - the same `scanBatchId` + provider twice → one request;
  - no files → still accepted (the list is the paper).
- [ ] **Step 2:** Run → FAIL; implement; → PASS. Then the full backend suite (known failures: doStockLeavesOnConfirm, renovationRecords, renovationTimeline, settlementRoutes, soLineFreezeRoutes, specialsRecordedNeverPriced) and `npx tsc -b`.
- [ ] **Step 3: Commit** `feat(utilities): one payment request per provider for scanned bills`. Ship the engine first: PR, merge, watch the deploy.

### Task 3: Property OS — tables, matching and the split rule

**Files:**
- Create: `migrations-pg/0197_utility_bill_scans.sql`. Check that 0197 is still free on production (`public.pos_migrations`) and on every branch first. Grant to the roles the other `pos` tables have.
  - `utility_account_marks` as in spec §5.3.
  - `utility_bill_scans`: `id`, `batch_id`, `document_id`, `model`, `read jsonb`, `proposed_account_id`, `colour`, `expense_id`, `created_by`, `created_at`.
  - `expenses.period_from date`, `expenses.period_to date`.
  - `owner_adjustments.expense_id text`.
- Create: `src/lib/utilityMatch.ts`, `src/lib/utilitySplit.ts`, each with a `.test.mjs`. Create `src/lib/fixtures/utility-pages.json`: reads from chew's Aug–Oct samples with names, addresses and full account numbers replaced.

**Interfaces:**
- Produces: `matchBill(read, accounts: AccountMark[], recent: RecentBill[]): { colour: 'green'|'amber'|'red'; accountId: string|null; candidates: { accountId: string; clues: string[] }[]; reasons: string[] }`, as in the 27 Oct plan Task 7.
- Produces: `contractSplit(period: { from: string; to: string }, amountSen: number, contracts: { startsOn: string; endsOn: string | null; ownerId: string }[]): { kind: 'none' } | { kind: 'split'; ownerId: string; insideSen: number; outsideSen: number; insideDays: number; outsideDays: number; totalDays: number } | { kind: 'two-contracts' }`.

- [ ] **Step 1: Failing tests:**
  - **Matching:** all the cases of the 27 Oct Task 7, Step 1.
  - **Split:**
    - SOP example: 31000 sen, 15 Aug–14 Sep, contract from 11 Sep → outside 27000, inside 4000, 27/4/31.
    - A contract ending 20 Sep on a 1–30 Sep bill → outside = 10 days' share.
    - A period wholly inside → `none`.
    - Wholly before → outside = all.
    - No contract → `none`.
    - Two contracts touching the period → `two-contracts`.
    - Rounding: 10000 sen over 3 days with 1 outside → 3333 / 6667.
- [ ] **Step 2:** `node --test src/lib/utilityMatch.test.mjs src/lib/utilitySplit.test.mjs` → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(utilities): match a scanned bill to a unit and split it by contract days`.

### Task 4: Property OS — scan and record endpoints

**Files:**
- Create: `functions/api/expenses/utilities/scan.ts`, `functions/api/expenses/utilities/scan/record.ts`, `functions/_lib/utilityMarks.ts`
- Modify: `functions/api/expenses/[id].ts` (deleting a scanned expense removes its open adjustments; refused when one is not open). Factor the per-row save of `functions/api/expenses/utilities.ts` into a helper both callers use, so the late-bill roll and the duplicate check are the same code.
- Test: `scripts/api-checks/utility-scan.mjs`, with the engine stubbed through `SCM_ENGINE_API`.

**Interfaces:**
- Produces: `POST /api/expenses/utilities/scan { documentId, batchId }` → `{ scanId, model, read, match, split }`. It reads the image from R2, forwards it to `/utility-bills/read`, retries with `retry: true` when Task 1's `needsRetry` says so or the match is red or out of range, then writes one `utility_bill_scans` row. It requires `session.manage` (403 otherwise).
- Produces: `POST /api/expenses/utilities/scan/record { batchId, rows: { scanId, accountId|unitId, kind, billMonth, periodFrom, periodTo, amountSen, chargeTo, ownerPaid }[] }` → `{ recorded, rolled, adjustments, byProvider: { provider, bills: […] }[] }`.
  - It runs in one transaction: expense (with the period), the split charge, the O2 credit, the marks, and `utility_bill_scans.expense_id`.
  - `byProvider` lists only rows not ticked "Owner paid".
- Produces: `POST /api/expenses/utilities/scan/payment-requests` (multipart: `data = { batchId }` + files). It builds the bills from that batch's recorded scans and calls Task 2 once per provider. It returns `{ requests: { provider, requestNo, amountSen }[] }`.

- [ ] **Step 1: Failing checks:**
  - Record a page → the expense has its `receipt_document_id`, period and the deduction month by today's rules, and a marks row exists.
  - The next month's page for that account matches green from the marks.
  - A recorded page recorded again, or the same unit, kind and month → refused, "Already recorded" (Review Focus 1).
  - Owner paid → a credit of the full amount, with `expense_id`.
  - The SOP example → an expense of RM 40 plus a charge of −RM 270.
  - The sum of the request lines = the unticked bills; payment requests twice → one per provider.
  - Deleting a scanned expense removes its open adjustments.
  - A non-manage user gets 403; the engine down → 502 with the bills still recorded.
- [ ] **Step 2:** Run → FAIL; implement; → PASS. Then run `npm run check`.
- [ ] **Step 3: Commit** `feat(utilities): scan, record and send scanned bills to finance`.

### Task 5: Property OS — Scan bills screen

**Files:**
- Create: `src/pages/owners/ScanBills.tsx`, `src/lib/pdfPages.ts`
- Modify: `src/pages/ExpensesPage.tsx` (a "Scan bills" button in utilities mode); `package.json` (`pdfjs-dist`, an exact version).

**Interfaces:**
- Produces: `pdfToJpegs(file: File, longEdge = 2000, quality = 0.85): AsyncGenerator<Blob>`.
- Consumes: `POST /api/documents` and the three endpoints of Task 4.

- [ ] **Step 1: Build:**
  - **The queue:** three pages at a time; rows appear as they finish; no overall limit; "Stop".
  - **The review table**, one row per page:
    - thumbnail (click to open the page);
    - kind, bill month, period, amount, unit (a searchable picker as in the voucher's unit picker);
    - colour and reasons; the split preview, e.g. "27 days owner alone RM 270.00 · 4 days shared RM 40.00";
    - "Owner paid this bill";
    - every field editable, with the preview following.
  - Green rows are pre-ticked to record; amber and red rows need a unit before they can be recorded.
  - "Record 37 bills", then the summary: rolled bills, owner lines, and "Send to finance: TNB RM 12,345.60 (36 bills)". The request goes out automatically after recording; a failure shows "Send to finance again".
  - Wide tables scroll in their own box; usable at phone width.
- [ ] **Step 2:** Verify in the Browser pane against a local engine stub, with a 40-page sample PDF whose personal fields are replaced:
  - pages stream in, and a slow page does not block the others;
  - an amber row cannot be recorded without a unit;
  - a hand-edited period changes the split;
  - take a screenshot.
- [ ] **Step 3:** Run `node scripts/checks/run.mjs`, `npm test`, and `npx tsc -p tsconfig.json --noEmit`.
- [ ] **Step 4: Commit** `feat(utilities): scan a month of bills and confirm them in one table`.

### Task 6: Accuracy run and release

- [ ] **Step 1:** Apply 0197 to production by hand: one transaction with its `public.pos_migrations` row, no DROP. Then open the PR, wait for the property-os and rbac checks, merge, and watch the deploy.
- [ ] **Step 2:** Run the scan on chew's Aug–Oct samples **without recording**. Report:
  - green, amber and red counts;
  - how many pages needed Sonnet;
  - any wrong green;
  - the API cost.

  If Haiku alone reads fewer than about three pages in four, ask chew before telling the team to use it.
- [ ] **Step 3:** A fresh opus reviewer goes over the engine and Property OS diffs against this plan's Review Focus. Fix the findings test-first.
- [ ] **Step 4:** Update `docs/finance/FINANCE-SOP.md` §3.10 (the split is built; owner paid → O2; one payment request per provider per scan), and tell chew in Chinese.
