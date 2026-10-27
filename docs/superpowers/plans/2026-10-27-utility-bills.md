# Utility Bills: Late Bills, Backfill and OCR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Utility bills in Property OS keep their real bill month and roll their owner deduction to the next open statement; January–October 2026 bills are backfilled from chew's payment listings; scanned bills are read by Claude, matched to units and confirmed by a person.

**Architecture:** Two new columns on `pos.expenses` (`deduct_month`, `record_only`, plus `rolled`) separate "what month the bill is for" from "which statement takes it"; the statement engine reads `deduct_month`. The backfill is a local script that produces a reviewed SQL plan applied through the production MCP connection. OCR is a browser queue (PDF → page JPEGs → receipt documents) calling one Pages Function per page, which asks Claude Haiku 5.5 and falls back to Sonnet 5.5, then scores the page against stored account fingerprints.

**Tech Stack:** Property OS (repo root): React + Vite in `src/`, Cloudflare Pages Functions in `functions/`, Postgres schema `pos` via `postgres` (Hyperdrive), R2 `MEDIA`; tests with `node --test src/lib/*.test.mjs` (imports `.ts` directly) and endpoint checks in `scripts/api-checks/*.mjs` against a local dev server and Postgres; `@anthropic-ai/sdk`; `pdfjs-dist` in the browser.

**Spec:** `docs/superpowers/specs/2026-10-27-utility-bills-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- All product text in English, British spelling, sentence case (chew, 2026-10-27).
- Money in sen (integers); dates as `YYYY-MM-DD` text; months as `YYYY-MM`.
- "Final" month for an owner = a statement in state `finalised`, `sent` or `paid` covering it (`LOCKED_SQL`, `functions/_lib/expenses.ts:20`).
- Utility categories: `electricity`, `water`, `internet`, `sewerage`. Roll-forward applies to these only.
- Migrations: `migrations-pg/NNNN_name.sql`, number = next free on `origin/main` at build time (main is at 0173 on 2026-10-27; ERP branches holding 0161/0162 are being renumbered separately); `set local search_path to pos`; header summary + `-- REVERSAL:` block; new tables owned by `pos_app`, RLS enabled, grants to `pos_app` (pattern: `migrations-pg/0127_service_prices.sql:138-145`).
- Production DB only through the MCP server `supabase-conts-prod` (project `cweomoenhsjvsxfsmiiw`). Apply each migration to production **before** merging, in one transaction with its `public.pos_migrations` row (checksum = first 16 hex chars of sha256 of the file with CRLF → LF).
- Every new endpoint: `requireSession`, `session.manage` for utilities, `audit(...)` on writes (`npm run check` enforces).
- Claude: `claude-haiku-5-5` first, `claude-sonnet-5-5` on a failed read, both effort `low`, model ids in one exported constant. No reading time limit; only a request with no response for 5 minutes is aborted and retried.
- Bills and listings contain personal data: never committed, never published, test fixtures use replaced personal fields.
- `ANTHROPIC_API_KEY` is set by chew as a Pages secret; never asked for in chat.

## Review Focus

1. A late bill must appear on exactly one statement: regenerate the same provisional statement twice and generate the next month — the bill is on one of them only. (Task 1/2 check.)
2. A final statement's total must not change after any save, edit, delete or the backfill. (Task 2 check, Task 5 verification.)
3. A utility bill whose bill month is final but whose deduction month is open must be editable and deletable; one whose deduction month is final must not. (Task 2 check.)
4. OCR must never pre-tick a row matched by a single supporting clue (building or owner name only), and must mark a bill already recorded for that unit, kind and month as "Already recorded". (Task 7 and 9 tests.)
5. A slow Claude response must not fail the page: a stub that answers after 90 s still produces a result. (Task 8 check.)

---

## Piece 1 — Late bills (spec §3)

### Task 1: Deduction month in the data and the statement engine

**Files:**
- Create: `migrations-pg/NNNN_expense_deduct_month.sql`
- Create: `src/lib/deductMonth.ts`, `src/lib/deductMonth.test.mjs`
- Modify: `functions/_lib/ownerStatement.ts` (`loadInputs` cost query `:426-429`, `computeMonth` `:486`, `computeUnitMonth` `:259`, `CostRow` type `:77`)
- Test: `scripts/api-checks/late-bills.mjs` (started here, extended in Task 2)

**Interfaces:**
- Produces: `firstOpenMonth(billMonth: string, finalMonths: ReadonlySet<string>): string` — the first `YYYY-MM` ≥ `billMonth` not in `finalMonths`.
- Produces: `CostRow` gains `deduct_month: string`; statements select costs by `deduct_month`.

- [ ] **Step 1: Write the failing unit test** `src/lib/deductMonth.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstOpenMonth } from './deductMonth.ts';
test('open bill month stays', () => assert.equal(firstOpenMonth('2026-09', new Set(['2026-08'])), '2026-09'));
test('final month rolls to the next', () => assert.equal(firstOpenMonth('2026-08', new Set(['2026-08'])), '2026-09'));
test('two final months roll past both, across a year end', () =>
  assert.equal(firstOpenMonth('2025-11', new Set(['2025-11', '2025-12'])), '2026-01'));
```

- [ ] **Step 2:** `node --test src/lib/deductMonth.test.mjs` → FAIL (module not found).
- [ ] **Step 3:** Implement `firstOpenMonth` in `src/lib/deductMonth.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Migration.** Add to `pos.expenses`: `deduct_month text`, `record_only boolean NOT NULL DEFAULT false`, `rolled boolean NOT NULL DEFAULT false`; back-fill `deduct_month = substr(incurred_on, 1, 7)`; then `SET NOT NULL` and `CHECK (deduct_month ~ '^\d{4}-(0[1-9]|1[0-2])$')`; index `(unit_id, deduct_month)`. Every existing `INSERT INTO expenses` site (list in spec research: `api/expenses/index.ts:55`, `utilities.ts`, `maintenance/issues/[id]/complete.ts`, `maintenance/issues/[id].ts`, `operations/job-invoices/*`, `_lib/approvals.ts`, `_lib/cleaning.ts`, `_lib/hostplatformImportDb.ts`) must set `deduct_month`; add a column `DEFAULT` is not possible from another column, so give each insert `substr(incurred_on,1,7)` explicitly (or a `BEFORE INSERT` trigger that fills a NULL `deduct_month` from `incurred_on` — choose the trigger if it keeps every insert site untouched, and say so in the migration header).
- [ ] **Step 6: Engine.** `loadInputs` costs: `e.charge_to = 'owner' AND NOT e.record_only AND e.deduct_month >= substr(from,1,7) AND e.deduct_month < substr(toExclusive,1,7)`; `computeMonth`/`computeUnitMonth` filter costs by `c.deduct_month === month`. Add `rolled` and `incurred_on` to `CostRow` for wording (Task 2).
- [ ] **Step 7: Check** `scripts/api-checks/late-bills.mjs` (style of `utility-bills.mjs`): seed an expense with `incurred_on` in month A and `deduct_month` B; generate statements for A and B; assert the line is on B only; regenerate B twice, still one line.
- [ ] **Step 8:** Run `npm test`, the new check, and the existing `scripts/api-checks/utility-bills.mjs`, `owner-statements-workbook.mjs`, `owner-adjustments.mjs` against a fresh local DB → all PASS.
- [ ] **Step 9: Commit** `feat(expenses): a bill's deduction month is kept apart from its bill month`.

### Task 2: Roll forward on save, locks by deduction month, record-only

**Files:**
- Modify: `functions/_lib/expenses.ts` (add helpers, keep `LOCKED_SQL`), `functions/api/expenses/utilities.ts`, `functions/api/expenses/[id].ts`, `functions/api/expenses/index.ts`, `functions/_lib/approvals.ts`, `functions/api/finance/expenses.ts`, `src/lib/receipts.ts`, `functions/_lib/ownerStatement.ts` (line wording)
- Test: `scripts/api-checks/late-bills.mjs`

**Interfaces:**
- Consumes: `firstOpenMonth` (Task 1).
- Produces: `finalMonthsFor(env, ownerIds: string[], from: string): Promise<Map<string, Set<string>>>` (owner → final months from `from` on); `isExpenseLocked(env, e: { unit_id: string; category: string; incurred_on: string; deduct_month: string }): Promise<boolean>`; `UTILITY_KINDS` constant; `receiptRequired` ignores `record_only` rows.
- Produces (HTTP): `POST /api/expenses/utilities` row result gains `deductMonth` when ≠ bill month; `GET` rows gain `deductMonth`, `recordOnly`, `rolled`.

- [ ] **Step 1: Extend the check** with the spec §3.3 cases: final month → saved, `deduct_month` = next open, `rolled = true`, statement line description `"Water Apr 2026 (late bill)"`, final statement total unchanged; two final months → third; replace a bill already on a final statement → 409 `PERIOD_LOCKED`; edit a rolled bill while its deduct month is open → 200; `record_only` bill → no statement line, no receipt needed; non-utility expense in a final month → still 409.
- [ ] **Step 2:** Run it → FAIL.
- [ ] **Step 3:** Implement: utilities POST computes `deduct_month` per row with `firstOpenMonth` instead of skipping locked units; refuses only a replace whose existing bill's `deduct_month` is final; the replace step matches account, kind and bill month (`incurred_on` month), never another month. `[id].ts`, `approvals.ts`, the finance list `locked` flag use `isExpenseLocked`. Statement lines: when `rolled`, description = `${KIND_LABEL} ${monthName(billMonth)} (late bill)`.
- [ ] **Step 4:** Run the check and the Task 1 suite → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(expenses): a utility bill for a final month goes on the next open statement`.

### Task 3: Utility bills screen tells the user where a bill is deducted

**Files:**
- Modify: `src/pages/owners/ExpenseEntry.tsx` (`UtilitiesModal`), `src/pages/ExpensesPage.tsx` (utilities mode)

**Interfaces:**
- Consumes: GET/POST fields from Task 2.

- [ ] **Step 1:** Before saving, for rows whose month is final, show: `"{Mon YYYY} is final. This bill will be deducted on the {Mon YYYY} statement."`; after saving, the toast counts rolled bills: `"3 bills saved. 1 will be deducted next month."`. In the list, a rolled bill shows `Deducted {Mon YYYY}` under its amount.
- [ ] **Step 2:** Run the app (`npm run dev`), verify in the browser pane against the local DB (save into a final month, see the notice and the label). Screenshot for the hand-over.
- [ ] **Step 3: Commit** `feat(utilities): the bills screen says when a bill rolls to the next statement`.

### Task 4: Release piece 1

- [ ] **Step 1:** Fresh opus reviewer on the branch diff (spec §3 + Review Focus 1–3); fix Critical/Important test-first.
- [ ] **Step 2:** Apply the migration to production via MCP in one transaction with its `pos_migrations` row; verify `SELECT count(*) FROM pos.expenses WHERE deduct_month IS NULL` = 0 and `SELECT count(*) FROM pos.expenses WHERE deduct_month <> substr(incurred_on, 1, 7)` = 0 (the back-fill moves nothing, so no statement can change).
- [ ] **Step 3:** Push, open the PR, watch CI, merge on green (chew: "检查跑完就上线"), watch the deploy, tell chew in Chinese.

---

## Piece 2 — Backfill (spec §4)

### Task 5: Read the original bills into a local table

Not product code. Done in a Claude Code session, files kept outside the repo (session scratchpad), personal data never committed.

- [ ] **Step 1:** Render every page of chew's Aug–Oct bills (`scratchpad/pdfimages.mjs`), read each page (account visible digits, deposit, building, bill month, amount due), write `bills-2026-08-10.json` `[{file, page, kind, billMonth, amountSen, accountVisible, depositSen, building, ownerName, meterPrevious, meterCurrent}]`.
- [ ] **Step 2:** Match each to a unit with the listing (amount + month + code) and the visible clues; list pages that match no listing row or two units — show chew only those, in chat.

### Task 6: Backfill script, dry run, apply

**Files:**
- Create: `scripts/backfill/utility-bills-2026.mjs` (reads listings + `bills-2026-08-10.json` + a DB snapshot JSON, writes `plan.sql` and `report.md` to a given output folder outside the repo)
- Create: `scripts/backfill/utilityBackfillRules.mjs`, `scripts/backfill/utilityBackfillRules.test.mjs`

**Interfaces:**
- Produces: `billMonthOf(desc: string, paidOn: string): { month: string; note: string }` (incl. `JAN - JUN26` → first month, months ahead of payment by ≤ 3 kept, more → previous year); `unitFor(projCode: string, desc: string, units: Unit[], billsByUnit): { unitId: string | null; how: string }` (ported from the session's `util-compare.cjs`, with chew's mappings in spec §4.2 as a table); `decide(row, systemBill, ownerFinalMonths): Action` where `Action` is one of `skip | record_only | charge | relabel | ask` with a reason.

- [ ] **Step 1: Failing tests** for `billMonthOf` (`'AGILE-C1313A TNB AUG26'` paid `2026-08-28` → `2026-08`; `'TRION A35-03A IWK JAN - JUN26'` → `2026-01`; `'ANGGUN 20-10 IWK JAN - JUN26'` paid `2026-04-17` → `2026-01`; `'... DEC26'` paid `2026-01-05` → `2025-12`), `unitFor` (`D-4204(A)` → SV2 D4203A; `B-1605(A)` → the side with bills; `OFF & WH` → null "company cost"; `B-13A07(R)` → null "showroom"), and `decide` (each row of the spec §4.2 table, plus: Sep bill for an owner whose Sep is final → `charge` with deduct month Oct and `rolled`; relabel collision → `skip` with reason).
- [ ] **Step 2:** `node --test scripts/backfill/utilityBackfillRules.test.mjs` → FAIL; implement; → PASS.
- [ ] **Step 3:** Snapshot production read-only via MCP (units, accounts, utility expenses 2025-12..2026-10, statements with state) to a local JSON; run the script; produce `plan.sql` (one transaction: create `WATER-<unit code>` water accounts, set water bill references, inserts, relabels) and `report.md` (counts per rule, RM charged to owners for Sep–Oct, owners whose states differ from the assumption, Jan–Aug amount differences per owner, `D-4204`/`D4203A` clashes).
- [ ] **Step 4:** Tell chew the one-line summary in Chinese (counts and RM) and any `ask` rows; wait for "go".
- [ ] **Step 5:** `plan.sql` is one statement sent in one MCP call, so it runs as one transaction: it first copies, into a temp table, the sum of owner-charged, non-record-only expenses per (owner, `deduct_month`) for every month final for that owner; then makes the changes; then recomputes the same sums and raises an exception (undoing everything) if any differs. Run it; on an exception, report to chew and stop.
- [ ] **Step 6:** Report to chew in Chinese: bills added, record-only count, RM charged, Jan–Aug differences total.
- [ ] **Step 7: Commit** the script and rules (no data) `chore(backfill): utility bills from the 2026 payment listings`.

---

## Piece 3 — OCR (spec §5)

### Task 7: Read schema, coercion and matching

**Files:**
- Create: `migrations-pg/NNNN_utility_bill_scans.sql` (`utility_account_marks`, `utility_bill_scans` per spec §5.3–5.4)
- Create: `src/lib/utilityBillRead.ts` (+ `.test.mjs`), `src/lib/utilityMatch.ts` (+ `.test.mjs`), `src/lib/fixtures/utility-pages.json` (extractions from the real samples with names, addresses and full account numbers replaced)

**Interfaces:**
- Produces: `BILL_READ_SCHEMA` (JSON schema for `output_config.format`, fields of spec §5.2); `coerceBillRead(raw: unknown): BillRead | { error: string }` (RM → sen, `null` for absent, masks normalised to `X`); `readFailed(r: BillRead): boolean` (no amount or no bill month).
- Produces: `matchBill(read: BillRead, accounts: AccountMark[], recent: RecentBill[]): { colour: 'green' | 'amber' | 'red'; accountId: string | null; candidates: { accountId: string; clues: string[] }[]; reasons: string[] }` with the clue weights of spec §5.3 and the guards of §5.4 (already recorded, amount ±50 % of last three).

- [ ] **Step 1: Failing tests:** full account number → green; visible pattern + deposit → green; visible pattern only → amber; building + owner name only → amber, never green (Review Focus 4); two accounts with one strong clue each → amber listing both; nothing → red; same unit/kind/month already recorded → `reasons` contains `Already recorded`; amount 3× usual → amber with `Much higher than usual`. Coercion: `"RM 1,311.18"` → 131118; `"2104010945XX02"` kept.
- [ ] **Step 2:** Run → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(utilities): read schema and unit matching for scanned bills`.

### Task 8: Scan endpoint (Haiku, then Sonnet)

**Files:**
- Create: `functions/api/expenses/utilities/scan.ts`, `functions/_lib/billReader.ts`
- Modify: `functions/_lib/db.ts` (`Env.ANTHROPIC_API_KEY?: string`, optional `ANTHROPIC_BASE_URL?: string` for the local stub), `package.json` (`@anthropic-ai/sdk`)
- Test: `scripts/api-checks/utility-scan.mjs` with a local stub server for the Messages API

**Interfaces:**
- Consumes: `BILL_READ_SCHEMA`, `coerceBillRead`, `readFailed`, `matchBill` (Task 7); R2 `env.MEDIA`; `documents` row of kind `receipt`.
- Produces (HTTP): `POST /api/expenses/utilities/scan { documentId }` → `{ scanId, model, read: BillRead, match }`; 503 `SCAN_NOT_SET_UP` "Bill scanning isn't set up yet." without the key; writes one `utility_bill_scans` row.
- Produces: `BILL_MODELS = { first: 'claude-haiku-5-5', retry: 'claude-sonnet-5-5' }`; `readBillPage(env, image: Uint8Array, mime: string, model: string): Promise<BillRead | { error: string }>`.

- [ ] **Step 1: Failing check:** stub returns a Haiku read missing the amount → endpoint calls again with Sonnet (stub sees the model id) and returns the Sonnet read; stub answers after 90 s → still a result (Review Focus 5); no key → 503; non-manage user → 403; the scan row exists with the model used.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `@anthropic-ai/sdk` (read the claude-api skill's TypeScript README first): image block from R2 bytes, prompt notes of spec §5.2, `output_config.format` with the schema, effort `low`, client timeout 5 minutes, SDK retries on; no other time limit.
- [ ] **Step 4:** Run → PASS; `npm run check` → PASS.
- [ ] **Step 5: Commit** `feat(utilities): read a scanned bill page with Claude`.

### Task 9: Record scanned bills and learn fingerprints

**Files:**
- Modify: `functions/api/expenses/utilities.ts` (rows may carry `billMonth`, `scanId`; save through Task 2 rules), create `functions/_lib/utilityMarks.ts`
- Test: extend `scripts/api-checks/utility-scan.mjs`

**Interfaces:**
- Consumes: Task 2 save rules; scan rows.
- Produces: `learnMarks(tx, accountId: string, read: BillRead): Promise<void>` (pattern, deposit, building, owner name, last meter reading, last bill month); `utility_bill_scans.expense_id` filled on save.

- [ ] **Step 1: Failing check:** record a scanned page → expense with `receipt_document_id` = the page, `deduct_month` by Task 2 rules, marks row created; a second page for the same account next month now matches green from the marks; recording a page already recorded → refused with `Already recorded`.
- [ ] **Step 2:** Run → FAIL; implement; → PASS.
- [ ] **Step 3: Commit** `feat(utilities): record scanned bills and remember each account`.

### Task 10: Scan bills screen

**Files:**
- Create: `src/pages/owners/ScanBills.tsx`, `src/lib/pdfPages.ts`
- Modify: `src/pages/ExpensesPage.tsx` (a "Scan bills" button in utilities mode), `package.json` (`pdfjs-dist`, pinned)

**Interfaces:**
- Consumes: `POST /api/documents`, `POST /api/expenses/utilities/scan`, `POST /api/expenses/utilities`.
- Produces: `pdfToJpegs(file: File, longEdge = 2000, quality = 0.85): AsyncGenerator<Blob>`.

- [ ] **Step 1:** Implement the queue (three pages at a time, results appear as they finish, no overall time limit, "Stop" cancels the unfinished pages), the review table (thumbnail, kind, bill month, amount, unit, colour + reasons; green pre-ticked; amber shows candidates; red needs a unit), "Record bills" with the count and the rolled notice from Task 3. Copy: "Scan bills", "Reading page 12 of 40", "Record 37 bills", "Already recorded", "Pick the unit".
- [ ] **Step 2:** Verify in the browser pane with the local stub (40-page sample PDF with personal fields replaced): pages stream in, a slow page does not block others, amber/red cannot be recorded without a unit. Screenshot.
- [ ] **Step 3: Commit** `feat(utilities): scan a month of bills and confirm them in one table`.

### Task 11: Accuracy run and release

- [ ] **Step 1:** After chew sets `ANTHROPIC_API_KEY` (tell chew where in Cloudflare: Pages → theconts-os → Settings → Variables and Secrets, encrypted; never in chat), run the scan endpoint on a preview deployment over chew's Aug–Oct samples; report green/amber/red counts, how many needed Sonnet, any wrong green, and the API cost; if Haiku alone reads fewer than about three in four pages, ask chew before releasing.
- [ ] **Step 2:** Fresh opus reviewer on piece 3's diff (spec §5 + Review Focus 4–5); fix Critical/Important test-first.
- [ ] **Step 3:** Apply the Task 7 migration to production via MCP (one transaction with its `pos_migrations` row); push, PR, CI, merge, watch the deploy; tell chew in Chinese.
