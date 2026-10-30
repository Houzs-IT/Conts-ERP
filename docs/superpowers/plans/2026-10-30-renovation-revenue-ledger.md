# Renovation revenue in the ledger — Implementation Plan (part 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Book renovation revenue exactly as invoiced: the contract posted whole to the project's own customer account and advance sub-account at signing, each invoice moving its amount from the advance to sub-category revenue accounts by the fixed waterfall, credit notes and cancellation lowering the contract.

**Architecture:** One pure module computes the waterfall (contract lines + cumulative net billed → revenue per line). A small ledger module turns contract events (signed, VO, invoice, credit note, cancel) into journals through the engine's `postJournal`, after the SQL transaction that made the event commits (the pattern `routes/renovation.ts` already uses for billing). What each event allocated to which revenue account is stored, so the next event posts only the difference (cumulative target − already allocated). Accounts resolve sub-category → category group → refuse.

**Tech Stack:** Engine backend (Hono, PostgREST client `sb`, SQL transactions `RenoDb`), vitest (`npx vitest run --config vitest.light.config.mts`), engine frontend (React, TanStack Query), Postgres migrations in repo-root `migrations-pg/`.

**Spec:** `docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md` (sections 2.1–2.6, 4, 7, 8). Part 2 (e-invoice readiness, 2.7) and part 3 (completion % in performance P&L and the project dashboard, 2.8) get their own plans.

## Global Constraints

- Product text in English (British); chat with chew in Chinese.
- Money in sen (integers). The invoice total is the law: allocations sum exactly to it (largest remainder).
- Tier order: SERVICE → (WORKS, LIGHTING) → BUILTIN → (FURNITURE, APPLIANCE, SOFT) → AIRBNB. Within a tier, in proportion to the lines' contract amounts.
- Ledger start date is 2026-11-01: an event dated before it posts nothing (the opening balances carry it); `postJournal` already answers `before_ledger_start`.
- A parent account (one with child accounts) can never be bound or posted to.
- Every new scm table: `grant all … to service_role, pos_app` (see `migrations-pg/0178_payment_requests_petty_cash.sql:212`). Production SQL never uses DROP. Migration numbers: Task 1 used 0184 (applied 2026-10-30; 0181–0183 were taken); Task 3 adds a NEW file with the next free number (check `public.pos_migrations` on production and every open branch first). Migrations are applied to production by hand, in one transaction with their `pos_migrations` row (checksum = sha256 of the file with CRLF→LF, first 16 hex), before the code merges.
- A customer with no account is never guessed onto a default (PR #473); a payment counts only once finance confirms it (PR #476). Do not weaken either.
- Engine frontend: run `npx tsc -b` before merging (the deploy runs it; `tsc --noEmit` is not enough).
- Tests that already fail on main and are not ours: specialsRecordedNeverPriced, soLineFreezeRoutes, renovationRecords, doStockLeavesOnConfirm, plus load-only timeouts (journalClasses, journalEntryEdit, opening, classifyTests).

## Review Focus

1. A VO that lowers a tier already invoiced → the next invoice posts the difference (it may give back from that tier); revenue to date always equals net invoiced. (Task 5)
2. An invoice cancelled after posting → its journal reversed and its allocations removed, so the next invoice re-fills those tiers. (Task 5)
3. A credit note bigger than what is invoiced so far → refused with a clear message. (Task 6)
4. A contract with lines whose product has no sub-category, or whose group has no binding → the invoice stays unposted, the reason names the group/sub-category (same rule as `group_unbound`). (Tasks 1, 5)
5. An old contract (signed before 1 Nov) gets its first invoice after go-live → allocation starts after its billed-before-go-live amount, and the advance account used is the one seeded for it. (Tasks 5, 8)

---

## File map

| File | Responsibility |
|---|---|
| `migrations-pg/0184_renovation_revenue_ledger.sql` (Task 1, applied) and the next free number for Task 3 | new tables and columns |
| `engine/backend/src/acc/reno-waterfall.ts` (new) | pure waterfall |
| `engine/backend/src/acc/reno-accounts.ts` (new) | account resolution by sub-category / group |
| `engine/backend/src/acc/reno-ledger.ts` (new) | contract journals: signed, VO, invoice, credit, cancel |
| `engine/backend/src/scm/lib/reno-contract-lines.ts` (new) | read a contract's revenue lines for the waterfall |
| `engine/backend/src/conts/parties.ts` | debtor per project |
| `engine/backend/src/scm/lib/renovation-so.ts`, `renovation-vo.ts`, `renovation-billing.ts`, `scm/routes/renovation.ts` | hooks after commit |
| `engine/backend/src/scm/lib/post-si-revenue.ts`, `acc/credit-notes.ts` | renovation branch |
| `engine/backend/src/acc/item-group-split.ts` | purchase lines by product sub-category |
| `engine/backend/src/scm/routes/accounting-item-groups.ts`, `engine/frontend/src/pages/scm-v2/ItemGroups.tsx` | sub-category bindings |
| `docs/finance/FINANCE-SOP.md` | SOP 2.1, 4.2, 4.2.1 rewritten (Task 10) |

---

### Task 1: Sub-category account bindings

**Files:**
- Create: `migrations-pg/0184_renovation_revenue_ledger.sql` (done, applied to production 2026-10-30)
- Create: `engine/backend/src/acc/reno-accounts.ts`
- Modify: `engine/backend/src/scm/routes/accounting-item-groups.ts`, `engine/frontend/src/pages/scm-v2/ItemGroups.tsx`
- Test: `engine/backend/src/acc/reno-accounts.test.ts`, `engine/backend/tests/itemGroups.test.ts`

**Interfaces:**
- Produces: table `scm.acc_sub_category_accounts (company_id bigint, sub_category_code text, sales_account text, purchase_account text, primary key (company_id, sub_category_code))`.
- Produces: `resolveLineAccounts(sb, companyId: number, keys: Array<{ group: string; subCategory: string | null }>, which: 'sales_account' | 'purchase_account'): Promise<{ ok: true; accountOf: (k: { group: string; subCategory: string | null }) => string } | { ok: false; status: 'group_unbound' | 'post_failed'; reason: string }>` in `acc/reno-accounts.ts`.
- Produces: `GET /accounting/item-groups` also returns `subCategories: [{ code, label, groupCode, salesAccount, purchaseAccount }]`; `PUT /accounting/item-groups/sub-categories/:code { salesAccount: string | null, purchaseAccount: string | null }` (null clears = fall back to the group).

- [ ] **Step 1: Write the failing tests** (`reno-accounts.test.ts`, fakeSb with `acc_item_group_accounts`, `acc_sub_category_accounts`)
  - `test('a sub-category binding wins over its group')`: TV_CABINET bound to 502-0010, BUILTIN group to 502-0050 → `accountOf({ group: 'BUILTIN', subCategory: 'TV_CABINET' })` is `'502-0010'`, `accountOf({ group: 'BUILTIN', subCategory: 'STUDY_TABLE' })` is `'502-0050'`.
  - `test('a group with neither binding refuses by name')`: `{ ok: false, status: 'group_unbound' }` and `reason` contains `'LIGHTING'`.
  - In `itemGroups.test.ts`: `test('a sub-category cannot be bound to a parent account')` — PUT with `salesAccount: '500-0000'` (has children) → 409 with the existing header message; with `'502-0010'` → 200 and the row saved.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run --config vitest.light.config.mts src/acc/reno-accounts.test.ts tests/itemGroups.test.ts`
- [ ] **Step 3: Implement** the table (+ grants), `resolveLineAccounts`, the two route changes reusing the route file's existing account check (missing / inactive / control / header), and on the Item Groups page a per-group expandable list of its sub-categories with the same account pickers ("Uses the group's account" when empty).
- [ ] **Step 4: Run, expect PASS**; `npx tsc -b` in engine/frontend.
- [ ] **Step 5: Commit** `feat(finance): bind accounts per product sub-category`

### Task 2: The waterfall

**Files:**
- Create: `engine/backend/src/acc/reno-waterfall.ts`
- Test: `engine/backend/src/acc/reno-waterfall.test.ts`

**Interfaces:**
- Produces:
  - `type RevenueLine = { key: string; group: string; subCategory: string | null; amountSen: number }`
  - `const TIERS: readonly (readonly string[])[] = [['SERVICE'], ['WORKS', 'LIGHTING'], ['BUILTIN'], ['FURNITURE', 'APPLIANCE', 'SOFT'], ['AIRBNB']]`
  - `waterfallTarget(lines: RevenueLine[], cumulativeSen: number): Map<string, number>` — revenue per line key after `cumulativeSen` of net billing.
  - `allocationDelta(target: Map<string, number>, already: Map<string, number>): Map<string, number>` — non-zero differences only.
- Rules: groups outside TIERS go after AIRBNB in one last tier; a tier's lines share its fill in proportion to `amountSen` (largest remainder); `cumulativeSen` above the contract total fills the last tier with the excess (over-billed); below 0 is refused (throw).

- [ ] **Step 1: Write the failing tests** with the spec's example: Service 200000 / Fixture (ELEC 400000, CEIL 500000) / BUILTIN 600000 / FURNITURE 1300000.
  - `waterfallTarget(lines, 1000000)` → SERVICE 200000, ELEC 355556, CEIL 444444, others 0 (sums 1000000).
  - `waterfallTarget(lines, 2000000)` → ELEC 400000, CEIL 500000, BUILTIN 600000, FURNITURE 300000, SERVICE 200000.
  - `allocationDelta(target(2000000), target(1000000))` → ELEC 44444, CEIL 55556, BUILTIN 600000, FURNITURE 300000.
  - Lowering: `waterfallTarget(lines, 400000)` after 1000000 → delta takes back from Fixture only (SERVICE unchanged).
  - Every result sums exactly to the cumulative.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(finance): renovation revenue waterfall`

### Task 3: Each contract opens its own customer account and advance sub-account

**Files:**
- Create: `migrations-pg/<next free number>_renovation_contract_ledger.sql` (check production and every branch first), `engine/backend/src/conts/parties.ts` (`ensureDebtorSql`), `engine/backend/src/scm/lib/renovation-so.ts` (`convertQuotationToSo`)
- Create: `engine/backend/src/acc/reno-advance-account.ts`
- Test: `engine/backend/src/conts/parties.test.ts`, `engine/backend/src/acc/reno-advance-account.test.ts`

**Interfaces:**
- Produces (migration): `scm.reno_so_contracts` gains `advance_account_code text`, `billed_before_golive_sen bigint not null default 0`; table `scm.reno_revenue_allocations (id uuid pk default gen_random_uuid(), company_id bigint not null, so_doc_no text not null, source_type text not null, source_doc_no text not null, line_key text not null, account_code text not null, amount_sen bigint not null, created_at timestamptz default now())` with index on `(so_doc_no)`; table `scm.reno_contract_credits (id uuid pk, company_id bigint, so_doc_no text, credit_note_id uuid, note_number text, amount_sen bigint check (amount_sen > 0), created_at, created_by)`. Grants as the global rule.
- Produces: `ensureDebtorSql(db, companyId, input & { perProject?: boolean })` — with `perProject: true` it never reuses: always the next code under the mapped control, name `"<customer> (<building> <unit>)"` as AutoCount names them.
- Produces: `openAdvanceAccountSql(db, companyId: number, p: { kind: 'RENOVATION' | 'INHOUSE_RENOVATION'; projectName: string }): Promise<string>` — child of 480-0000 (RENOVATION) or 481-0000 (INHOUSE_RENOVATION), code = parent prefix + first letter of the project name + next running number (3 digits at least, unbounded — reuse `nextPartyCode`), account type and section copied from the parent, active.
- `convertQuotationToSo` calls `ensureDebtorSql(..., perProject: true)` and `openAdvanceAccountSql`, and stores the code on `reno_so_contracts.advance_account_code`. A missing control map or parent account refuses the conversion with a message naming what finance must set (no guessing).

- [ ] **Step 1: Write the failing tests**
  - parties: `test('a per-project debtor is never reused')` — MS LEE already has 301-M001 → `perProject: true` returns 301-M002 named "MS LEE (SKYLINE D-25-13)".
  - advance: `test('the advance sub-account opens under the brand parent')` — kind INHOUSE_RENOVATION, project "SKYLINE D-25-13", existing 481-S011 → `'481-S012'`, inserted with parent 481-0000.
  - advance: `test('no parent account refuses by name')`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(finance): a renovation contract opens its own customer and advance accounts`

### Task 4: Contract posted whole, and VOs post their difference

**Files:**
- Create: `engine/backend/src/acc/reno-ledger.ts`
- Modify: `engine/backend/src/scm/routes/renovation.ts` (after-commit hooks for convert and VO apply; find the convert route and the VO apply route beside the bill route at `:301`)
- Test: `engine/backend/tests/renoLedger.test.ts` (fakeSb)

**Interfaces:**
- Produces: `contractPostedSen(sb, soDocNo): Promise<number>` = sum of the contract's live SO rows excluding `RENO-CREDIT` rows (see Task 6).
- Produces: `postContractChange(sb, p: { companyId: number; soDocNo: string; date: string; actor: string }): Promise<PostResult>` — posts `contractPostedSen − already posted on source 'RCON'/'RVO' for this SO`: positive → Dr customer control (party = the contract's debtor) / Cr advance account; negative → the reverse. First posting source type `RCON` (doc no = SO doc no), later ones `RVO` (doc no = SO doc no + `-` + n). Zero → `{ ok: true, status: 'nothing' }`. Before the ledger start → `before_ledger_start`, no row.
- The convert and VO-apply routes call it after commit, best-effort, and return `posting` like the bill route.

- [ ] **Step 1: Write the failing tests**
  - `test('signing posts the whole contract to the project accounts')`: contract 10,000,000 sen, debtor 301-M002 (control 301-0000), advance 480-S012 → one RCON journal Dr 301-0000 (party 301-M002) 10,000,000 / Cr 480-S012 10,000,000.
  - `test('a VO posts only the difference, up or down')`: +500,000 → RVO Dr 301-0000 / Cr 480-S012 500,000; then −200,000 → RVO Dr 480-S012 / Cr 301-0000 200,000.
  - `test('a contract signed before the ledger start posts nothing')`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(finance): renovation contract and VOs posted to the project's accounts`

### Task 5: Invoices move the advance to revenue by the waterfall

**Files:**
- Create: `engine/backend/src/scm/lib/reno-contract-lines.ts`
- Modify: `engine/backend/src/acc/reno-ledger.ts`, `engine/backend/src/scm/lib/post-si-revenue.ts` (branch when the invoice's SO is `so_kind = 'RENOVATION'`), `engine/backend/src/scm/routes/sales-invoices.ts` (refuse line add/edit/delete on a renovation invoice; cancel → also delete that invoice's allocations)
- Test: `engine/backend/tests/renoLedger.test.ts`, `engine/backend/src/scm/lib/reno-contract-lines.test.ts`

**Interfaces:**
- Consumes: `waterfallTarget`, `allocationDelta` (Task 2); `resolveLineAccounts` (Task 1); `reno_revenue_allocations`, `billed_before_golive_sen` (Task 3).
- Produces: `contractRevenueLines(sb, soDocNo): Promise<RevenueLine[]>` — live SO rows; group and sub-category from `item_code → mfg_products (company, ACTIVE first)`; `RENO-ADJUST` (lump sum) spread over its section's inside lines in proportion to their nominal amounts (qty × unit price), equally by count if all are 0; `RENO-DISCOUNT` spread over every line in proportion; `RENO-PROGRESS` and `RENO-CREDIT` excluded; key = SO item id.
- Produces: `netBilledSen(sb, soDocNo): Promise<number>` = posted renovation invoices − contract credits (`reno_contract_credits` + negative instalment bills) + `billed_before_golive_sen`.
- Produces: `postRenovationInvoice(sb, invoice): Promise<PostSiResult>` — journal (source `SI`, doc = invoice number): Dr advance account invoice total / Cr each revenue account its delta (delta of target(netBilled after) − allocations so far, grouped by account; a negative delta is a debit). Writes allocation rows for this source. If the SO has no allocation rows and `billed_before_golive_sen > 0`, first writes `source_type 'OPENING'` rows = target(billed_before_golive_sen) without a journal.
- `postSiRevenue` calls it for renovation invoices instead of the item-group split.

- [ ] **Step 1: Write the failing tests**
  - `test('an invoice books Dr advance / Cr revenue by the waterfall')`: the Task 2 contract, invoice 1,000,000 → Dr 480-S012 1,000,000; Cr 505-0000 200,000, 501-0020 355,556, 501-0030 444,444.
  - `test('the second invoice continues where the first stopped')`.
  - `test('after a VO lowers fixture, the next invoice absorbs it')` — Review Focus 1.
  - `test('a cancelled invoice gives its tiers back')` — reversal + allocations gone; the next invoice re-fills Fixture (Review Focus 2).
  - `test('a line with no binding leaves the invoice unposted, by name')` (Review Focus 4).
  - `test('an old contract continues after its billed-before-go-live amount')` (Review Focus 5).
  - contract-lines: `test('a lump sum is spread over the lines inside it')`, `test('the header discount lowers every line in proportion')`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(finance): renovation invoices move the advance to revenue by the waterfall`

### Task 6: Credit notes lower the contract

**Files:**
- Modify: `engine/backend/src/scm/lib/renovation-billing.ts` (new `creditContract`; `billingView` counts credits in `billedSen` net), `engine/backend/src/scm/routes/renovation.ts` (route), `engine/backend/src/acc/credit-notes.ts` (`postCreditNote` branch for a CN whose `so_doc_no` is a renovation SO), `engine/backend/src/acc/reno-ledger.ts`, the renovation billing panel in the engine frontend (button "Credit note")
- Test: `engine/backend/tests/renoLedger.test.ts`

**Interfaces:**
- Produces: `creditContract(db, actor, soDocNo, body: { amountSen: number; reason: string; noteDate?: string }): Promise<{ noteNumber: string; creditNoteId: string }>` — refuses `amountSen` > net billed (`'credit_exceeds_billed'`, Review Focus 3); inserts an `acc_credit_notes` row (kind CN, party = contract debtor, so_doc_no) with one line, a `RENO-CREDIT` SO row of `−amountSen` (lowers the revised contract for later instalments), and a `reno_contract_credits` row.
- Produces: `POST /renovation/sales-orders/:docNo/credit { amountSen, reason, noteDate? }` (permission as billing), posting after commit.
- Produces: `postRenovationCredit(sb, note)` — Dr revenue accounts (allocation delta for the lower net billed, from the last tier back) / Cr customer control (party = debtor), total = note total. Negative instalment bills (existing `billInstalment` branch) post through the same function instead of the RENOVATION sales-return account.

- [ ] **Step 1: Write the failing tests**
  - `test('a discount credit lowers revenue, what the customer owes and the contract')`: invoiced 1,000,000, credit 500,000 → net billed 500,000, target SERVICE 200,000 / ELEC 133,333 / CEIL 166,667 → Dr 501-0020 222,223 / Dr 501-0030 277,777 (taken back from Fixture, SERVICE untouched) / Cr 301-0000 (party 301-M002) 500,000; next instalment worked on contract − 500,000.
  - `test('a credit above what is billed is refused')`.
  - `test('a negative instalment posts as a renovation credit, not to the RENOVATION group account')`.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(finance): renovation credit notes lower revenue and the contract`

### Task 7: Cancel contract clears what was never invoiced

**Files:**
- Modify: `engine/backend/src/scm/lib/renovation-so.ts` (`setContractStatus` to `CANCELLED`: drop the `has_bills` refusal, keep the purchase-order refusal), `engine/backend/src/scm/routes/renovation.ts` (after-commit posting), `engine/backend/src/acc/reno-ledger.ts`
- Test: `engine/backend/tests/renoLedger.test.ts`

**Interfaces:**
- Produces: `postContractCancel(sb, p: { companyId; soDocNo; date; actor })` — source `RCAN`: Dr advance / Cr customer control for the advance balance left (contract posted − gross invoiced); zero → nothing.

- [ ] **Step 1: Write the failing test** `test('cancelling after a partial refund leaves the kept part as revenue')` — chew's example: contract 10,000,000, invoice 1,000,000, credit 600,000, cancel → RCAN 9,000,000; afterwards advance 0, revenue 400,000 (in SERVICE first), customer control movement for the SO = 10,000,000 − 600,000 − 9,000,000.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5: Commit** `feat(finance): cancelling a renovation contract clears the unbilled part`

### Task 8: Existing contracts at go-live

**Files:**
- Create: `engine/backend/src/scm/routes/accounting-reno-opening.ts`, a section on the engine Ledger setup page "Renovation contracts at go-live" (upload an Excel with columns: SO doc no, customer account, advance account, invoiced before go-live (RM)) with a preview table and Apply
- Test: `engine/backend/tests/renoOpening.test.ts`

**Interfaces:**
- Produces: `POST /accounting/renovation-opening/preview` and `/apply` with `{ rows: [{ soDocNo, debtorCode, advanceAccountCode, billedBeforeGoLiveSen }] }`. Preview flags: unknown SO, debtor not under 301/302 or 303, advance account not a child of 480/481, amount above the contract. Apply writes `mfg_sales_orders.debtor_code`, `reno_so_contracts.advance_account_code`, `billed_before_golive_sen`; posts nothing (opening balances carry the money). It also records the contract amount at go-live as the RCON baseline (an allocation-free marker the RVO logic reads, e.g. a zero-journal baseline row or a column `posted_contract_sen`), so a VO after go-live on an old contract posts its difference (PR 2 posts nothing for contracts signed before the ledger start). Finance permission (`scm.payment_voucher.post`).

- [ ] **Step 1: Write the failing tests** — preview refuses each bad row by name; apply writes the three fields and no journal.
- [ ] **Step 2–4:** FAIL, implement, PASS; `npx tsc -b`.
- [ ] **Step 5: Commit** `feat(finance): seed existing renovation contracts at go-live`

### Task 9: Purchases by sub-category, and "bill the next instalment" on confirm

**Files:**
- Modify: `engine/backend/src/acc/item-group-split.ts` (lines carrying `item_code` resolve their product's category group / sub-category through `resolveLineAccounts` for `purchase_account`; lines without a product keep the line's `item_group`), purchase-invoice posting callers to pass `item_code`; `engine/backend/src/acc/receipt-confirm.ts` and `OfficialReceipts.tsx` (after a confirm on a renovation SO whose confirmed receipts exceed net billed, the response carries `billNext: { soDocNo, instalmentId, amountSen }` and the screen offers "Bill the next instalment now" / "Later")
- Test: `engine/backend/tests/itemGroups.test.ts` or `src/acc/item-group-split.test.ts`, `tests/confirmCustomerReceipts.test.ts`

- [ ] **Step 1: Write the failing tests** — `test('a renovation supplier line books to its sub-category purchase account')` (TV_CABINET → 602-0010); `test('a confirm that leaves more received than billed offers the next instalment')`; `test('a confirm within what is billed offers nothing')`.
- [ ] **Step 2–4:** FAIL, implement, PASS; `npx tsc -b`.
- [ ] **Step 5: Commit** `feat(finance): renovation purchases by sub-category; offer the next instalment on confirm`

### Task 10: SOP

**Files:** Modify `docs/finance/FINANCE-SOP.md`

- [ ] **Step 1:** Rewrite 2.1 (one customer account per project, named with the unit), 4.2 (deposit = first progress billing, non-refundable by default, refund by credit note; invoice first, payment-before-invoice prompt), 4.2.1 (books follow the invoices: contract whole to the project advance at signing, invoices move it to revenue by the waterfall Service → Fixture → Carpentry → Furniture → Airbnb into sub-category accounts; credit notes lower the contract; Cancel contract; completion % is management only — performance P&L and dashboard, part 3), keeping the decision dates. Chinese, like the rest of the SOP.
- [ ] **Step 2: Commit** `docs(finance): SOP — renovation revenue follows the invoices`

---

## PRs

- PR 1: Tasks 1–2 (no ledger effect).
- PR 1 (#481) live 2026-10-30.
- PR 2: Tasks 3–4 + its migration applied first.
- PR 3: Tasks 5–7.
- PR 4: Tasks 8–9.
- PR 5: Task 10 (can go with PR 3).

Each PR: tests + `tsc` (backend) + `npx tsc -b` (frontend) + full light suite in the background, a fresh reviewer, then merge with `gh pr merge --merge`, watch the deploy.
