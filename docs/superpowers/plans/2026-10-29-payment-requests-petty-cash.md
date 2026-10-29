# Staff Payment Requests and Petty Cash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff hand in receipts and ask finance to pay suppliers from either system. Each department's petty cash float pays the receipts back. Finance checks, pays, tops up and lists everything in the engine's Finance area.

**Architecture:** The engine owns all data and rules: `scm` tables and `engine/backend/src/conts/`.
- Staff reach engine endpoints under `/scm/my/*`:
  - from the engine itself;
  - from Property OS through the existing frame (office staff);
  - through Property OS Functions that forward, server to server, with a signed staff assertion (field staff on the phone).
- Finance endpoints sit behind the existing Ledger gate.
- Money moves only through the existing Payment voucher; journals only through `acc/engine.ts` `postJournal`.

**Tech Stack:**
- Engine: Hono and the PostgREST client (`c.get('supabase')`, pinned to `scm`), tested with vitest and `fakeSb`; React with React Query and SheetJS.
- Property OS: Cloudflare Pages Functions with `functions/_lib/db.ts`, and React. Checks are `tsc`, `npm run check`, and `scripts/api-checks/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md`. The business rules are in `docs/finance/FINANCE-SOP.md` §3.2, §3.5 and §6.

## Global Constraints

- All product text is English with British spelling. Field portal strings exist in all four of `en`, `ms`, `zh` and `my` (`src/lib/portalI18n.ts`; a missing key fails `tsc`).
- Amounts are integer sen. Display uses the existing formatters (`fmtSenPlain` in the engine; `src/lib/format.ts` in Property OS).
- New `scm` tables:
  - live in root `migrations-pg/0178_payment_requests_petty_cash.sql`;
  - are owned by `scm_engine`, with RLS enabled;
  - `revoke … from anon, authenticated`, `grant all … to service_role, pos_app`, `notify pgrst, 'reload schema'`;
  - are applied by hand to production in one transaction with their `public.pos_migrations` row, before the code merges;
  - contain no `DROP` in the applied SQL.
- Public tables are read with `sb.schema('public')`. Tests wrap worlds in `publicTablesOnly`.
- Every staff query is filtered by the caller's Property OS user id. A keeper's queries are filtered by their own float.
- Field staff see the amounts of their own receipts only: never a balance, a quote or a job cost. A keeper also sees their own float.
- A receipt is never refused for a project limit or for a float going below zero; both are flagged.
- No new UI or chart libraries. Engine pages copy `engine/frontend/src/conts/LimitRequests.tsx`. Excel goes through `engine/frontend/src/lib/xlsx-runtime.ts`.
- **Prerequisite:** the project-limit branch (`feat/finance-project-limit`, migration `0177_project_limit.sql`) is merged and its migration applied. Everything below builds on it.

## Review Focus

1. **A replaced or rejected receipt changes the balance once only.**
   - A replacement counts; the receipt it replaces does not.
   - A repayment adds back once.
   - Test: balance after reject → replace equals the balance with only the replacement.
2. **A receipt on a project with no float, once vouchered, stops counting in the project limit.** The voucher's lines count instead.
   - Test: project used = one amount, not two, after Create voucher and post.
3. **Cancelling a top-up voucher undoes it.**
   - Remove its PAID_IN event and return its receipts to CHECKED.
   - Test: balance and statuses equal those before the voucher posted.
4. **A field user cannot read another person's receipts by guessing an id**, and a keeper cannot read another float.
   - Test: 404 for someone else's id on every `/scm/my/*` read.
5. **The staff assertion is refused when expired, re-signed with a different secret, or naming a disabled user.**
   - Test: 401 on each.

---

## PR B — Data and petty cash core (engine)

### Task 1: Migration 0178 and its views

**Files:**
- Create: `migrations-pg/0178_payment_requests_petty_cash.sql`
- Test: `engine/backend/tests/migration0178.test.ts` (asserts on the SQL text, as other migration tests do)

**Tables** (all `scm`, `company_id bigint not null`, `created_at timestamptz default now()`):
- `petty_cash_floats`
  - `id uuid pk`, `department_id text not null`, `keeper_user_id text not null`
  - `float_sen int not null check (>=0)`, `warn_pct int not null default 20`, `active bool default true`
  - `topup_requested_at timestamptz`
  - unique `(company_id, department_id) where active`; unique `(company_id, keeper_user_id) where active`
- `petty_cash_overrides`
  - `(company_id, user_id text)` pk, `float_id uuid references petty_cash_floats`
- `staff_receipts`
  - `id uuid pk`, `receipt_no text unique per company`, `submitter_user_id text not null`, `float_id uuid null`
  - `spend_date date not null`, `amount_sen int not null check (>0)`, `vendor_name text`, `note text`
  - `status text check in ('HANDED_IN','CHECKED','TOPPED_UP','PAID_BACK','REJECTED','REPAID','WRITTEN_OFF','REPLACED')`
  - `reject_reason`, `checked_at`, `checked_by`, `je_id`, `topup_pv_id`, `payback_pv_id`
  - `replaces_id uuid`, `writeoff_account_code`, `writeoff_je_id`
  - `source text check in ('engine','property_os','field_app')`
- `staff_receipt_lines`
  - `id`, `receipt_id`, `department text check in ('rental','supply','shared')`
  - `unit_id text`, `maintenance_issue_id text`, `project_id`, `account_code text`
  - `amount_sen int check (>0)`, `description`, `sort`
- `staff_receipt_files`
  - `id`, `receipt_id`, `r2_key`, `file_name`, `mime`, `byte_size`
- `petty_cash_events`
  - `id`, `float_id`, `kind check in ('PAID_IN','RETURNED','REPAID')`, `amount_sen int check (>0)`
  - `pv_id`, `receipt_id`, `event_date date`, `note`, `created_by text`
- `payment_requests`
  - `id`, `request_no`, `type check in ('PAYMENT','DEPOSIT')`, `requester_user_id`
  - `supplier_id`, `payee_name`, `payee_to_check bool`, `purchase_order_id`
  - `wanted_on`, `owes_formal_invoice bool`, `note`, `amount_sen`
  - `status check in ('SUBMITTED','PART_PAID','PAID','REJECTED','CLOSED','WITHDRAWN')`, `reason`
- `payment_request_lines`: same columns as receipt lines
- `payment_request_files`: same columns as receipt files
- `staff_bank_details`
  - `(company_id, user_id)` pk, `bank_name`, `account_no`, `account_name`, `checked_by`, `checked_at`

**Alters:**
- `scm.payment_vouchers` add `payment_request_id uuid`, `petty_cash_float_id uuid`, `staff_receipt_id uuid`.
- `scm.payment_voucher_lines` add `unit_id text`.

**Views:**
- `create or replace view public.conts_staff` keeps today's columns in order and appends `department_id`, `department_side` (from `pos.departments.side`) and `role`.
- `public.conts_units`: id, building name, unit number.
- `public.conts_maintenance_jobs`: id, unit_id, title, assignee user id, state.
- `public.conts_employee_bank`: user id, bank_name, bank_account, from `pos.employees` through the technician and cleaner rosters.
- `pos.staff_receipt_job_lines`: maintenance_issue_id, receipt_no, amount_sen, status. It is granted to `pos_app` and leaves out REPLACED and REJECTED.

Each `public` view gets `revoke … from public, anon, authenticated; grant select … to scm_engine`.

**Steps:**

- [ ] **Step 1: Write the failing test.** `migration0178.test.ts` reads the file and asserts:
  - every table above is created;
  - it contains `enable row level security`, `grant all` to `service_role, pos_app`, and `notify pgrst`;
  - stripped of `--` comments, it has no `drop `.
- [ ] **Step 2: Run it and see it fail.**
  `cd engine/backend && npx vitest run tests/migration0178.test.ts`
  Expected: FAIL (the file is missing).
- [ ] **Step 3: Write the migration.** The header carries REVERSAL, APPLY and the purpose, as `0177_project_limit.sql` does. Set `set local search_path = scm, public, extensions;`.
- [ ] **Step 4: Run it and see it pass.**
- [ ] **Step 5: Apply it to a scratch database.** Run `node scripts/ci-api-db.mjs`, the same path as CI. Expected: no error.
- [ ] **Step 6: Commit.** `feat(claims): tables for receipts, floats and payment requests (0178)`

### Task 2: Pure petty cash arithmetic

**Files:**
- Create: `engine/backend/src/conts/petty-cash.ts`
- Test: `engine/backend/src/conts/petty-cash.test.ts`

**Interfaces (produced):**
```ts
export type ReceiptStatus = 'HANDED_IN'|'CHECKED'|'TOPPED_UP'|'PAID_BACK'|'REJECTED'|'REPAID'|'WRITTEN_OFF'|'REPLACED';
export interface FloatEvent { kind: 'PAID_IN'|'RETURNED'|'REPAID'; amountSen: number }
export function floatBalance(events: FloatEvent[], receipts: { amountSen: number; status: ReceiptStatus }[]): number
export function topUpAmount(floatSen: number, balanceSen: number): number          // max(0, float - balance)
export function lowBalance(floatSen: number, balanceSen: number, warnPct: number): boolean
export function resolveFloatId(userId: string, deptId: string | null,
  overrides: Map<string, string>, activeFloatByDept: Map<string, string>): string | null
export function lineDepartment(side: string | null): 'rental'|'supply'|'shared'
export function receiptCountsForLimit(r: { status: ReceiptStatus; paybackPvId: string | null }): boolean
```

`floatBalance` = Σ PAID_IN − Σ receipts whose status is not REPLACED + Σ REPAID − Σ RETURNED.

`receiptCountsForLimit` is true unless:
- the status is REPLACED, REPAID or WRITTEN_OFF; or
- `paybackPvId` is set (the voucher counts instead).

- [ ] **Step 1: Write the failing tests.**
  - `floatBalance` with paid in 100000 and receipts 4500 (HANDED_IN) and 2000 (REPLACED) gives 95500.
  - Adding a REPAID event of 4500 gives 100000.
  - `topUpAmount(100000, -12000)` is 112000; `topUpAmount(100000, 100000)` is 0.
  - `lowBalance(100000, 19999, 20)` is true; `(100000, 20000, 20)` is false.
  - `resolveFloatId`: an override wins; otherwise the department's float; otherwise null.
  - `lineDepartment`: `'conts'` gives rental; `'dream_crafter'` gives supply; `'both'` and null give shared.
  - `receiptCountsForLimit`: `{CHECKED, paybackPvId:'x'}` is false; `{REJECTED, null}` is true; `{REPAID, null}` is false.
- [ ] **Step 2: Run them and see them fail.**
  `cd engine/backend && npx vitest run --config vitest.light.config.mts src/conts/petty-cash.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): float balance, top-up and routing rules`

### Task 3: Petty cash account rule and the receipt journal

**Files:**
- Modify:
  - `engine/backend/src/acc/rules.ts`: `AccountRole` and `DEFAULT_ROLE_CODES` gain `PETTY_CASH`.
  - `engine/backend/src/conts/ledger-setup-status.ts`: `roleKind` treats `PETTY_CASH` as money.
  - `engine/frontend/src/conts/ledgerSettings.ts`: `ROLE_LABELS.PETTY_CASH = 'Petty cash'`.
- Create: `engine/backend/src/conts/petty-cash-ledger.ts`
- Test: `engine/backend/src/conts/petty-cash-ledger.test.ts`

**Interfaces (produced):**
```ts
export async function postReceiptJournal(sb: any, companyId: number, r: { receiptNo: string; spendDate: string;
  lines: { accountCode: string; amountSen: number; department: string; description?: string }[] }): Promise<PostJournalResult>
// sourceType 'CLM', Dr each line, Cr resolveRoles().PETTY_CASH; entryDate = max(spendDate, ledger_start_date)
export async function postWriteOffJournal(sb: any, companyId: number, r: { receiptNo: string; amountSen: number;
  accountCode: string; date: string }): Promise<PostJournalResult>   // sourceType 'CLW', Dr account, Cr PETTY_CASH
```

- [ ] **Step 1: Write the failing tests** (with `fakeSb`, a chart that has the accounts, and `acc_account_roles` holding PETTY_CASH).
  - A receipt with lines 3000 and 1500 posts a balanced entry: Dr 3000 and Dr 1500 to their accounts, Cr 4500 to the petty cash account.
  - A spend date before `ledger_start_date` is dated on the ledger start date.
  - A write-off posts Dr the chosen account, Cr petty cash.
  - Posting the same receipt twice returns `already_posted`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**, using `postJournal`, `resolveRoles` and `loadLedgerSettings`.
- [ ] **Step 4: Run them and see them pass. Also run** `npx vitest run tests/ledgerSetupStatus.test.ts`.
- [ ] **Step 5: Commit.** `feat(claims): petty cash account and receipt journals`

### Task 4: Who is asking (staff identity)

**Files:**
- Create: `engine/backend/src/conts/staff-identity.ts`
- Test: `engine/backend/src/conts/staff-identity.test.ts`

**Interfaces (produced):**
```ts
export interface Staff { userId: string; name: string; email: string; departmentId: string | null; side: string | null; role: string; field: boolean }
export async function staffByEmail(sb: any, email: string): Promise<Staff | null>   // reads public.conts_staff via sb.schema('public'); inactive -> null
export const staffMiddleware: MiddlewareHandler   // sets c.set('staff', Staff); 401 { error: 'not_staff' } when unknown
export function signStaffAssertion(secret: string, a: { userId: string; email: string; exp: number }): Promise<string>
export function verifyStaffAssertion(secret: string, token: string, now?: number): Promise<{ userId: string; email: string } | null>
```

`staffMiddleware` takes the person from one of two places:
1. the engine session (`c.get('houzsUser').email`);
2. failing that, the header `x-conts-staff`, verified with `env.CONTS_SSO_SECRET`. The token format is the same as `conts/sso.ts`: `base64url(JSON).base64url(HMAC-SHA256)`, with `exp` at most 60 s ahead.

When the header path is used, the asserted `userId` must equal the view row's `id`.

- [ ] **Step 1: Write the failing tests.**
  - A signed token round-trips.
  - An expired token gives null.
  - A token signed with the wrong secret gives null.
  - `exp` more than 60 s ahead gives null.
  - The middleware with an unknown email gives 401.
  - An inactive staff member gives 401.
  - A header whose `userId` differs from the email's row gives 401.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): staff identity from the engine session or a signed staff assertion`

### Task 5: Finance petty cash endpoints

**Files:**
- Create: `engine/backend/src/conts/petty-cash-routes.ts`
- Modify:
  - `engine/backend/src/scm/routes/accounting.ts`: mount it under `/accounting/petty-cash`, behind the existing Ledger gate;
  - `engine/backend/src/services/permissions.ts`.
- Test: `engine/backend/src/conts/petty-cash-routes.test.ts`

**Endpoints** (Ledger edit = `scm.payment_voucher.write`; Ledger full = `scm.payment_voucher.approve`):

| Method | Path | Level | What it does |
|---|---|---|---|
| GET | `/accounting/petty-cash/floats` | view | Overview rows `{id, departmentId, departmentName, keeperUserId, keeperName, floatSen, balanceSen, waitingCheckSen, waitingCheckCount, lastTopUpOn, low, topUpRequested}` plus totals |
| POST | `/accounting/petty-cash/floats` | full | `{departmentId, keeperUserId, floatSen, warnPct?}`. 409 when the department or keeper already has an active float |
| PATCH | `/accounting/petty-cash/floats/:id` | full | `{keeperUserId?, floatSen?, warnPct?, active?}` |
| GET | `/accounting/petty-cash/floats/:id/receipts?month=YYYY-MM` | view | Receipts with lines, file ids, submitter name, overLimit flag |
| GET | `/accounting/petty-cash/receipts?float=none&status=` | view | Receipts to pay back (no float) |
| POST | `/accounting/petty-cash/receipts/check` | edit | `{items: [{id, amountSen?, lines?}]}`. Corrects, sets CHECKED and checked_by, and posts `postReceiptJournal` for float receipts. A no-float receipt posts nothing |
| POST | `/accounting/petty-cash/receipts/:id/reject` | edit | `{reason}` (required). HANDED_IN only |
| POST | `/accounting/petty-cash/receipts/:id/repaid` | edit | REJECTED → REPAID, plus a REPAID event |
| POST | `/accounting/petty-cash/receipts/:id/write-off` | full | `{accountCode}`. REJECTED → WRITTEN_OFF, plus `postWriteOffJournal` |
| POST | `/accounting/petty-cash/floats/:id/returned` | edit | `{amountSen, date, note}`. RETURNED event |
| POST | `/accounting/petty-cash/floats/:id/top-up` | full | `{bankAccountCode}`. Calls `createPaymentVoucherCore` with payee = the keeper's name, one line Dr PETTY_CASH of `topUpAmount`, Cr the bank, `purpose: 'OTHER'`, `notes` listing the checked receipt numbers. Sets `petty_cash_float_id`. Returns `{pvId, pvNumber, amountSen}`. 409 when the amount is 0 |
| POST | `/accounting/petty-cash/receipts/:id/voucher` | full | No-float receipt: a voucher to the submitter with lines = receipt lines, Cr the chosen bank, `staff_receipt_id` set. 409 `bank_details_missing` when neither `staff_bank_details` nor `conts_employee_bank` has a row |
| GET / PUT | `/accounting/petty-cash/overrides` | view / full | `[{userId, floatId}]` |
| GET / PUT | `/accounting/staff-bank/:userId` | view / full | |

- [ ] **Step 1: Write the failing tests.** Mount on a bare Hono app as `project-limit-routes.test.ts` does. They cover:
  - the overview balance follows the events and receipts;
  - a duplicate float gives 409;
  - check posts one `CLM` entry per float receipt and none for a no-float one;
  - reject without a reason gives 422;
  - write-off needs full access (403 at edit);
  - top-up creates a DRAFT voucher of float − balance with `petty_cash_float_id`;
  - voucher creation for a no-float receipt with no bank details gives 409.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Receipt numbers are `CLM-YYMM-NNN` (PCR- is the consignment receive prefix) per company: reuse the doc number helper used for `nextPvDraftNo`, or a counter in the same style.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): finance petty cash endpoints`

### Task 6: Voucher post and cancel hooks

**Files:**
- Create: `engine/backend/src/conts/claims-voucher-hooks.ts`
- Modify: `engine/backend/src/scm/routes/payment-vouchers.ts`
  - in `postPaymentVoucherHandler`, after the POSTED update (next to the refund `…BestEffort` calls, ~:1174);
  - in `cancelPaymentVoucherHandler`, after `reverseJournal` (~:1739).
- Test: `engine/backend/tests/claimsVoucherHooks.test.ts`

**Interfaces (produced):**
```ts
export async function afterVoucherPostedBestEffort(sb: any, pv: { id: string; petty_cash_float_id: string|null;
  staff_receipt_id: string|null; payment_request_id: string|null; voucher_date: string; total_sen: number }): Promise<void>
export async function afterVoucherCancelledBestEffort(sb: any, pv: same): Promise<void>
```

**On post:**
- **A float voucher:**
  - insert a PAID_IN event `{amount: pv total, pv_id, event_date: voucher_date}`;
  - CHECKED receipts on that float with `topup_pv_id` null become TOPPED_UP with `topup_pv_id`.
- **A receipt voucher:** the receipt becomes PAID_BACK, and `payback_pv_id` is set.
- **A request voucher:** the request's status is recomputed (Task 9's `requestStatus`).

**On cancel:** the exact reverse.
- Delete the PAID_IN event by `pv_id`. This is a row delete in app code, not migration SQL.
- Receipts with that `topup_pv_id` go back to CHECKED.
- A PAID_BACK receipt goes back to CHECKED, and `payback_pv_id` is cleared.
- The request is recomputed.

Errors are logged, never thrown.

- [ ] **Step 1: Write the failing tests.**
  - Post then cancel a top-up voucher: the float's balance and every receipt status equal the starting state (Review Focus 3).
  - Posting a receipt voucher marks it PAID_BACK.
  - A hook failure does not fail the post.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement and wire it in.**
- [ ] **Step 4: Run them, then the existing `tests/pvPostNow.test.ts`, `tests/pvProjectLimit.test.ts` and `tests/pvFiles.test.ts`. All pass.**
- [ ] **Step 5: Commit.** `feat(claims): vouchers settle top-ups, paid-back receipts and requests`

### Task 7: Project limit counts receipts and requests

**Files:**
- Modify: `engine/backend/src/conts/project-limit.ts`
- Test: `engine/backend/src/conts/project-limit.test.ts` (extend)

The used amount gains receipt lines whose receipt passes `receiptCountsForLimit`.

The reserved amount gains SUBMITTED / PART_PAID request lines, per project, minus the lines of the request's non-cancelled vouchers on that project, floored at 0.

- [ ] **Step 1: Write the failing tests.**
  - A HANDED_IN receipt line of 5000 on P1 makes used = 5000.
  - Once `payback_pv_id` is set and that voucher posts with the same line, used is still 5000 (Review Focus 2).
  - A request of 10000 with one voucher of 4000 reserves 6000.
  - A CLOSED request reserves 0.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): receipts and requests in the project limit`

**PR B ends here.** Push, open the PR, and run the fresh reviewer, CI and merge per the method below. Apply 0178 to production before merging.

---

## PR C — Staff endpoints and payment requests (engine)

### Task 8: `/scm/my/*` receipts, keeper and OCR

**Files:**
- Create: `engine/backend/src/conts/my-claims-routes.ts`
- Modify: `engine/backend/src/scm/index.ts`: `scm.use('/my/*', staffMiddleware); scm.route('/my', myClaims)`, mounted with no `scmAreaGuard` and no `requireLedgerAccess`.
- Test: `engine/backend/src/conts/my-claims-routes.test.ts`

**Endpoints** (the caller is `c.get('staff')`):

| Method | Path | What it does |
|---|---|---|
| POST | `/my/extract` | `{files:[{name,mime,dataBase64}]}` → `extractOneBill`. Returns `{amountSen, date, vendorName}`. 503 without `ANTHROPIC_API_KEY` |
| POST | `/my/receipts` | `{spendDate, amountSen, vendorName?, note?, lines[], files[{name,mime,dataBase64}], replacesId?, source}` |
| GET | `/my/receipts?month=` | The caller's own receipts. Amounts, status and reason; no balance |
| GET | `/my/receipts/:id/files/:fileId` | Streams a file. 404 unless the receipt is the caller's, or on the caller's kept float |
| GET | `/my/float` | 404 unless the caller keeps an active float. Returns `{floatSen, balanceSen, low, receipts (month)}` |
| POST | `/my/float/top-up-request` | Sets `topup_requested_at` |
| GET | `/my/jobs` | Open maintenance jobs from `conts_maintenance_jobs`: field staff see their own; others see all |
| GET | `/my/units` | From `conts_units` |

**POST `/my/receipts`** works like this:
- It resolves `float_id` by `resolveFloatId`.
- `department` defaults to `lineDepartment(staff.side)`.
- A line with `maintenance_issue_id` takes the job's unit, and department `rental`.
- Files: up to 8, 20 MB each, `DOC_FILE_MIMES`, stored at `` `claims/${companyId}/${receiptId}/${uuid}.${ext}` `` in `c.env.SLIPS`.
- With `replacesId` (the caller's own REJECTED receipt), the old one becomes REPLACED and the new one keeps its float.
- It is never refused for a balance or a limit.
- It returns `{id, receiptNo, route: 'float' | 'finance'}`.

- [ ] **Step 1: Write the failing tests.**
  - Hand in with no float goes to `route: 'finance'`; with the department's float, `'float'`; an override wins.
  - Someone else's receipt id gives 404 (Review Focus 4).
  - A keeper sees only their own float: another float's file gives 404.
  - `replacesId` of someone else's receipt gives 404.
  - A REPLACED receipt is left out of the balance (Review Focus 1).
  - A field staff member's `/my/jobs` lists only their own jobs.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Reuse `decodeBase64` and `DOC_FILE_MIMES` from `scm/lib/doc-files.ts`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): staff hand in receipts; keepers see their float`

### Task 9: Payment requests

**Files:**
- Create:
  - `engine/backend/src/conts/payment-requests.ts` (pure)
  - `engine/backend/src/conts/payment-request-routes.ts`
- Modify:
  - `my-claims-routes.ts`: add the staff routes;
  - `accounting.ts`: mount the finance routes under `/accounting/payment-requests`.
- Test: `payment-requests.test.ts` and `payment-request-routes.test.ts`

**Interfaces (produced):**
```ts
export function requestStatus(amountSen: number, postedVoucherSen: number, current: string): 'SUBMITTED'|'PART_PAID'|'PAID'|string
// terminal statuses (REJECTED, CLOSED, WITHDRAWN) are returned unchanged
```

**Staff:**
- `POST /my/requests`: `{type, supplierId?, payeeName?, purchaseOrderId?, wantedOn?, owesFormalInvoice?, note?, lines[], files[]}`.
  - A DEPOSIT needs `supplierId`.
  - A PO fills the supplier.
  - An unknown payee sets `payee_to_check`.
  - It runs the project-limit check and refuses with 409 `over_limit` (SOP §3.2).
- `GET /my/requests`
- `POST /my/requests/:id/withdraw`: only while no voucher exists.

**Finance:**
- `GET /accounting/payment-requests?status=&type=`
- `POST /:id/voucher` (full): `createPaymentVoucherCore` pre-filled from the request; `payment_request_id` set.
  - A DEPOSIT uses `purpose: 'SUPPLIER_PAYMENT'` with the supplier, so it posts to the supplier and is recorded in `acc_supplier_advances` the way existing supplier advances are.
  - 409 when `payee_to_check` is set and no supplier is linked.
- `POST /:id/reject` (edit): reason required.
- `POST /:id/close` (full): reason required; PART_PAID only.
- `PATCH /:id/supplier` (edit): links a supplier and clears `payee_to_check`.

- [ ] **Step 1: Write the failing tests.**
  - `requestStatus(10000, 0, 'SUBMITTED')` is SUBMITTED; `(10000, 4000, …)` is PART_PAID; `(10000, 10000, …)` is PAID; `(…, 'CLOSED')` is CLOSED.
  - A deposit without a supplier gives 422.
  - Over the limit gives 409.
  - Withdraw after a voucher gives 409.
  - The deposit voucher's purpose is SUPPLIER_PAYMENT.
  - Close frees the reservation.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit.** `feat(claims): payment requests to suppliers, against a PO, and deposits`

### Task 10: Every office staff member may sign in for My claims

**Files:**
- Modify:
  - `engine/backend/src/conts/access.ts`: `hasAnyAccess` also returns true when `access.claims` is `'edit'`;
  - `engine/backend/src/conts/sso.ts`: no change beyond using it;
  - `functions/_lib/scmEngine.ts`: the assertion's `access` gains `claims: 'edit'` for every non-field, non-owner session.
- Test:
  - `engine/backend/tests/contsSso.test.ts` (extend, or the existing sso test file);
  - `scripts/api-checks/nav-engine-map.mjs` stays green.

- [ ] **Step 1: Write the failing test.** An operations_staff assertion whose areas are all `none` and `claims: 'edit'` gets a role id; the same without `claims` gets 403.
- [ ] **Step 2: Run it and see it fail.**
- [ ] **Step 3: Implement.** A person signed in only through `claims` reaches `/my/*` and the My claims page, nothing else: their engine page access stays empty.
- [ ] **Step 4: Run it and see it pass. Also run `npx tsc --noEmit -p .` at the root.**
- [ ] **Step 5: Commit.** `feat(claims): every office staff member can open My claims in the engine`

**PR C ends here.**

---

## PR D — Engine screens

The design rules follow the `dashboard-design` skill and the engine's own theme:
- Overview first: totals and low-balance markers.
- Amounts right-aligned, in RM.
- Loading, empty and error states.
- Light and dark themes through the existing CSS variables.

### Task 11: My claims page

**Files:**
- Create:
  - `engine/frontend/src/conts/MyClaims.tsx`
  - `engine/frontend/src/conts/myClaimsQueries.ts`
  - `engine/frontend/src/conts/ReceiptForm.tsx`
- Modify:
  - `engine/frontend/src/App.tsx`: route `/scm/my-claims`, without `ContsLedgerGate` and without `ScmGuard`;
  - `engine/frontend/src/routing/routeManifest.ts`;
  - `components/Sidebar.tsx`: a "My claims" item visible to every signed-in Conts user;
  - `conts/navOnly.ts` `KEEP`.
- Test: `engine/frontend/src/conts/MyClaims.test.tsx`

**Tabs:**
- **Hand in a receipt**:
  - files → `/my/extract`, which fills the amount, date and vendor; the person confirms;
  - lines: department, unit / job / project, category (account), amount, description;
  - shows where it will go: "Paid from <department> petty cash" or "Paid back by finance".
- **Ask finance to pay**: supplier or PO picker, lines, files.
- **Mine**: receipts and requests, with status, reason and voucher number.
- **Petty cash I keep**: only when `/my/float` gives 200. Balance (the danger colour below zero), low banner, month filter, receipts with thumbnails, **Ask for a top-up**.

- [ ] **Step 1: Write the failing tests** (vitest and testing-library, mocked `authedFetch`):
  - The OCR result fills the amount field.
  - The "Petty cash I keep" tab is absent when `/my/float` gives 404.
  - A negative balance renders with the danger class.
  - The submit body carries the lines' sum as `amountSen`.
- [ ] **Step 2: Run them and see them fail.**
  `cd engine/frontend && npx vitest run src/conts/MyClaims.test.tsx`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass. Then run `npx tsc -b` and `npx vitest run src/routing`.**
- [ ] **Step 5: Commit.** `feat(claims): My claims page`

### Task 12: Finance — Payment requests page

**Files:**
- Create: `engine/frontend/src/conts/PaymentRequests.tsx` (copy the `LimitRequests.tsx` structure)
- Modify:
  - `App.tsx`: `/scm/payment-requests` with `ContsLedgerGate` + `ScmGuard area="scm.finance.accounting"`;
  - `routeManifest.ts`;
  - `Sidebar.tsx`: group "Money out".
- Test: `PaymentRequests.test.tsx`

The list has filters, and Submitted comes first, oldest first. Each request has a detail drawer (lines, files, payee) with the actions **Create voucher**, which goes to the new voucher, **Reject** (reason), **Close** (reason) and **Link supplier**.

- [ ] **Steps 1–5 as Task 11.**
  - Tests: Reject cannot be sent without a reason; Create voucher is hidden without `scm.payment_voucher.approve`.
  - Commit: `feat(claims): finance payment requests page`

### Task 13: Finance — Petty cash overview, float page and settings

**Files:**
- Create:
  - `engine/frontend/src/conts/PettyCash.tsx` (overview)
  - `engine/frontend/src/conts/PettyCashFloat.tsx`
  - `engine/frontend/src/conts/pettyCashExport.ts`
  - `engine/frontend/src/conts/pettyCashQueries.ts`
- Modify: `App.tsx`, `routeManifest.ts`, `Sidebar.tsx`. The routes are `/scm/petty-cash` and `/scm/petty-cash/:id`, gated like Task 12.
- Test: `PettyCash.test.tsx` and `pettyCashExport.test.ts`

**Overview:**
- Columns: department, keeper, float, balance, waiting for a check, last top-up, marker.
- Totals row.
- New float and Change float dialogs.
- An "Overrides" section.
- A "Receipts to pay back" tab for no-float receipts (Check, Create voucher, Reject).
- Staff bank details are edited from that tab's row when they are missing.

**Float page:**
- A header of KPI cards: float, balance, waiting for a check.
- Month filter, defaulting to this month.
- Table columns: date, submitter, description, department, unit / job / project, account (editable while HANDED_IN), amount (editable while HANDED_IN), status, receipt thumbnails, flags.
- Bulk Check, Reject, Repaid, Write off, Returned, Top up (shows the amount; posts and links to the voucher).
- Export to Excel.

**Interfaces (produced):**
```ts
export function pettyCashRows(receipts: FloatReceipt[]): (string | number)[][]
// header + one row per receipt line: Date, Receipt no, Submitter, Description, Department, Unit/Job/Project, Account, Amount (RM, 2dp number), Status, Receipts (count)
export async function exportPettyCash(floatName: string, month: string, receipts: FloatReceipt[]): Promise<void>
// writeLineExportFile(pettyCashRows(...), 'Petty cash', `Petty cash ${floatName} ${month}.xlsx`)
```

- [ ] **Steps 1–5 as Task 11.**
  - Tests:
    - `pettyCashRows` with two receipts of 2 and 1 lines gives 1 + 3 rows; the amount 4500 sen becomes `45`; the receipts column shows the file count.
    - The overview totals row sums float and balance.
    - Write off is hidden without approve.
  - Commit: `feat(claims): petty cash overview, float listing and Excel export`

**PR D ends here.**

---

## PR E — Property OS: My claims entry and the field portal

### Task 14: Forwarding Functions

**Files:**
- Create:
  - `functions/_lib/claimsForward.ts`
  - `functions/api/claims/[[path]].ts`
- Modify: `functions/_lib/scmEngine.ts`: export `staffAssertion(env, session)`, which signs `{userId, email, exp: now+45s}` with `SCM_ENGINE_SSO_SECRET`.
- Test: `scripts/api-checks/claims-forward.mjs`

**Interfaces (produced):**
```ts
export async function forwardToClaims(env: Env, session: Session, method: string, enginePath: string, body?: unknown): Promise<Response>
// fetch(`${env.SCM_ENGINE_API}/api/scm/my${enginePath}`, { headers: { 'x-conts-staff': await staffAssertion(env, session) } })
```

- `/api/claims/*` lets through only:
  - `GET` and `POST` `receipts`;
  - `GET` `receipts/:id/files/:fileId`;
  - `GET` `float`;
  - `POST` `float/top-up-request`;
  - `POST` `extract`;
  - `GET` `jobs` and `units`.
- Anything else gives 404.
- It needs a session, gives 501 when the engine is not configured, and writes `audit()` for the POSTs (the `npm run check` rules).

- [ ] **Step 1: Write the failing check.**
  - Unsigned gives 401.
  - A path outside the list gives 404.
  - With the engine unconfigured, 501.
- [ ] **Step 2: Run it against the local server and see it fail.**
  `API_BASE=http://localhost:8788 node scripts/api-checks/claims-forward.mjs`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it and see it pass; then `npm run check` and `npx tsc --noEmit -p .`.**
- [ ] **Step 5: Commit.** `feat(claims): Property OS forwards staff claim calls to the engine`

### Task 15: My purchase on a maintenance job

**Files:**
- Modify:
  - `functions/api/maintenance/issues/[id]/documents.ts`: kind `purchase` is accepted. After the document row is written, the file is forwarded as a receipt with `{spendDate: today MYT, amountSen, lines: [{maintenanceIssueId: id, amountSen}], files:[that file], source}`.
    - `amountSen` comes from the form field `amountSen`. The phone reads it by calling `/api/claims/extract` before upload and shows it for confirmation.
    - A forwarding failure leaves the document saved and returns `{documentId, receipt: 'failed'}`.
  - `src/pages/FieldRepairsPage.tsx`:
    - the kinds list gains `'purchase'`;
    - choosing it shows the confirm-amount step (OCR result, editable) before upload.
  - `src/lib/portalI18n.ts`: `repairs.fileKind.purchase` and the confirm-step strings, in all four languages.
  - The office job page shows a "Staff purchases" line from `pos.staff_receipt_job_lines` beside actual cost. Find it with `git grep -n "contractor_amount" src/pages`.
- Test: extend `scripts/api-checks/mobile-field.mjs`. A technician uploads kind `purchase` with amountSen 4500 on their own job, and gets 201 with `receipt` not `'failed'` when the engine is stubbed. The engine is unconfigured in CI, so CI asserts `receipt: 'failed'` and that the document is still saved.

- [ ] **Steps 1–5.** Commit: `feat(claims): a technician's own purchase on a job is handed in as a receipt`

### Task 16: Hand in a receipt, My receipts, keeper tab (field portal)

**Files:**
- Create:
  - `src/pages/FieldReceiptsPage.tsx` (Hand in, and My receipts)
  - `src/pages/FieldPettyCashPage.tsx` (keeper)
- Modify:
  - `src/App.tsx`: `/portal/receipts` and `/portal/petty-cash` inside FieldShell;
  - `src/components/FieldShell.tsx`: a "Petty cash" tab shown only when `/api/claims/float` gives 200; "Hand in a receipt" is a button on the Jobs tab;
  - `src/lib/portalI18n.ts`: a new `receipts` block and `nav.pettyCash`, in four languages.

**Screens:**
- **Hand in:** photo(s) → extract → amount (editable) → optional unit → note → send.
- **My receipts:** this month and last, with amounts and status words.
- **Keeper:** balance, receipts this month (photo, submitter, amount), Ask for a top-up.

**Test:** `scripts/api-checks/mobile-field.mjs` (extend). A cleaner's GET `/api/claims/float` gives 404, and the portal tab list has no Petty cash for them.

- [ ] **Steps 1–5.** Also run `npm run check` (the English-only rule allow-lists `portalI18n.ts`) and `npx tsc --noEmit -p .`, which catches missing language keys.
  - Commit: `feat(claims): field portal receipts and the keeper's petty cash tab`

### Task 17: My claims in the Property OS sidebar

**Files:**
- Modify:
  - `src/lib/scmEngine.ts`: `ENGINE_PATH['/my-claims'] = '/scm/my-claims'`;
  - `src/lib/navigation.ts`: a "My claims" item with no area (as `itSupport`), shown to every non-field role, and hidden when the engine is not configured;
  - the `LEDGER_ICON` / icon map.
- Test: `scripts/api-checks/nav-engine-map.mjs` (extend): the item exists and maps to `/scm/my-claims`.

- [ ] **Steps 1–5.** Commit: `feat(claims): My claims in the Property OS sidebar`

**PR E ends here.**

---

## Method (chew's, per PR)

1. **Test first**, task by task, as above.
2. **Review:** a fresh reviewer on the most capable model reviews the whole PR diff against this plan and the spec. Fix Critical and Important findings.
3. **Migrations:** apply them to production through `supabase-conts-prod` in one transaction, with the `pos_migrations` row. The checksum is the sha256 of the LF-normalised file, first 16 hex characters. Apply before merging.
4. **Ship:**
   - push and open the PR;
   - CI must be green;
   - merge with `gh pr merge --merge` (no auto-merge);
   - watch the deploy and check https://theconts-os.pages.dev.
5. **Before PR E is live:** field accounts and department placement are set up by management, outside this plan. Finance sets the first floats and the PETTY_CASH account in Ledger setup.
