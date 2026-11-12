# Maintenance job claims and the three receipt options — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a person who paid for work picks how they are paid back, and finance can pay a supplier a technician names.
- Petty Cash (Claim), the default: from their petty cash.
- Direct Claim to Me: finance transfers it to them, to the bank account they confirm on the claim.
- Direct Pay to Supplier: finance pays a supplier the technician names. This is on the phone's Receipts page only.

The upload area on a maintenance job is reduced to one claim box and one store-only box. It is the same on the phone and on the computer.

**Architecture:**
- **Finance system (engine).**
  - A hand-in can ask finance to pay it back (`payBack: 'finance'`). Such a receipt is never put on a float, and it carries the bank details given on it.
  - A field worker may now ask finance to pay a supplier, by name only (a PAYMENT, with no list or PO).
  - Finance's Petty cash page shows a direct claim's own bank details, and says when they differ from the saved ones. The payback voucher uses the claim's own details.
- **Property OS.**
  - The job's documents route forwards the choice and the bank details.
  - The phone job sheet and the desk job page get the same two boxes.
  - The phone Receipts page gets the three options.
  - The saved bank details are read for prefill through a new read-only `GET /claims/my-bank`. The saved records (HR, and finance's `staff_bank_details`) are never written by these screens.

**Tech Stack:**
- engine backend: Hono, the PostgREST client, vitest with `fake-postgrest`;
- engine frontend: React;
- Property OS: Pages Functions and React; `portalI18n` in four languages: English, Malay, Chinese, Burmese.

**Decisions (chew, 12 Nov 2026, in chat):**
- Job upload: only "Petty Cash (Claim)" or "Direct Claim to Me", and an invoice must be attached.
- Direct Claim to Me does not touch petty cash; finance pays them directly.
- "Receipt / Proof of work and product" is one extra box to attach, store only, optional.
- Default: Petty Cash (Claim).
- Direct Claim to Me needs bank details. They are shown for confirming and can be changed, "但不要碰我这里保存的银行记录".
- The computer's job page is the same as the phone.
- The Receipts page has three options: petty cash, finance pay (= Direct Claim to Me) and direct pay to supplier.
- OCR stays. The person need not wait for it.

## Global Constraints

- **Copy.** Product copy on the desk and in the engine is British English, with no CJK in `src/` except the portal translations in `src/lib/portalI18n.ts`. Field screens use `portalI18n` in all four languages.
- **Money** is in sen, as integers.
- **Bank details on a claim:**
  - the bank comes from `MALAYSIAN_BANKS` (`functions/_lib/hrFields.ts`);
  - the account number is digits only, 5–30 of them;
  - the account name is 1–100 characters.
- **The saved bank records** (`public.conts_employee_bank`, `scm.staff_bank_details`) are read, never written, by these flows.
- **Migration** `0309_claim_bank_details.sql` goes through `migrate-production.yml` (dry run first) with chew's OK, before merge. The engine writes the new columns.
- **Old files.** Documents already on jobs keep their kinds and labels. No data is changed.
- **Rules unchanged:**
  - a person's float (override, else department float) still decides Petty Cash;
  - a field worker sees no balance, quote or job cost, except a keeper's own float;
  - a replacement keeps its float.

## Review Focus

1. A department with no active float: only Direct Claim to Me (and, on Receipts, Direct Pay to Supplier) is offered. A Petty Cash choice sent anyway goes to finance, as today. Task 1.
2. A direct claim whose bank details match the saved record: there is no "differs" flag, and the voucher uses the claim's details. Task 4.
3. A technician's Direct Pay to Supplier naming a supplier id or a PO: refused, because a field worker cannot see the list. A deposit: refused. Task 2.
4. A replacement for a rejected direct claim keeps finance as the payer and takes the new bank details. Task 1.
5. A person who types the amount before OCR returns: the read does not overwrite it, and they can hand in at once. Tasks 6 and 7, checked in the browser.

---

### Task 1: Engine — a claim finance pays back directly, with its bank details

**Files:**
- `engine/backend/src/conts/my-claims-routes.ts`: `handInHandler`, and a new `myBankHandler` on `GET /my-bank`;
- `engine/backend/src/conts/petty-cash-routes.ts`: `bankDetailsOf` is reused;
- test: `engine/backend/src/conts/my-claims-routes.test.ts`.

**Interfaces:**
- **Hand-in body** gains `payBack?: 'float' | 'finance'`. `'finance'` sets `float_id` null. It requires `bank: { bankName, accountNo, accountName }`, validated as in Global Constraints, else 422 "Enter the bank the money goes to.". The bank is stored in `payee_bank_name`, `payee_account_no` and `payee_account_name`.
- **A replacement** keeps the old receipt's float, unless the new one says `'finance'`.
- **`GET /my-bank`** → `{ bankName, accountNo, accountName } | null` for the signed-in person only, from `bankDetailsOf`.

**Tests, written first:**
- D1: a technician with a float hands in with `payBack: 'finance'` and a bank. `float_id` is null, `route` is `'finance'`, and the bank is stored.
- D2: `'finance'` with no bank, or an account with letters → 422.
- D3: no `payBack` → the float, as before. The existing tests still pass.
- D4: `GET /my-bank` returns the person's own saved details. HR is used when finance has none, and the call never writes.

- [ ] Write D1–D4. Run `npx vitest run --config vitest.light.config.mts src/conts/my-claims-routes.test.ts` in `engine/backend`. Expected: they fail.
- [ ] Implement. Run again. Expected: they pass. Commit.

### Task 2: Engine — a field worker asks finance to pay a supplier, by name

**Files:**
- `engine/backend/src/conts/payment-request-routes.ts` (`submitRequestHandler`);
- test: `my-claims-routes.test.ts`, which already holds the request tests.

**Rules for a field worker:**
- only a `PAYMENT`;
- no `supplierId` and no `purchaseOrderId`, each refused with a 422 that names the field;
- `payeeName` is required;
- the files, the amount and the lines are as for office staff.

The old test "a field worker hands receipts in but does not ask finance to pay" is replaced by these.

- [ ] Write the tests: allowed by name; supplier id refused; PO refused; deposit refused. Run them. Expected: they fail.
- [ ] Implement, run, commit.

### Task 3: Migration 0309 — the bank details on a claim

**Files:** `migrations-pg/0309_claim_bank_details.sql`.
- It adds nullable `payee_bank_name text`, `payee_account_no text` and `payee_account_name text` to `scm.staff_receipts`. The column grants follow the table's.
- Header: APPLY with only=0309, dry run first; REVERSAL drops the three columns (by hand).

- [ ] Write it. Check that PGlite starts with it. Commit.

### Task 4: Engine — finance sees and pays to a direct claim's bank details

**Files:**
- `engine/backend/src/conts/petty-cash-routes.ts`: the "Paid back by finance" list, and `POST /accounting/petty-cash/receipts/:id/voucher`;
- `engine/frontend/src/conts/PettyCash.tsx`;
- test: `petty-cash-routes.test.ts`.

**Interfaces:**
- The list's rows gain `bank: { bankName, accountNo, accountName, fromClaim: boolean, differsFromSaved: boolean } | null`.
- The voucher uses the claim's bank when there is one, else `bankDetailsOf`.

**Tests:**
- V1: a voucher for a direct claim names the claim's bank in its notes.
- V2: `differsFromSaved` is true when the account number differs, and false when it is the same.

- [ ] Write V1 and V2, see them fail, implement, then see them pass.
- [ ] The screen shows the bank under the receipt, with a "Not the saved account" badge when it differs.
- [ ] Commit.

### Task 5: Property OS — the job's documents route

**Files:**
- `functions/api/maintenance/issues/[id]/documents.ts`;
- `src/lib/claims.ts`: `myBank()`, and `bankProblem(b)` for the shared form rules;
- test: `src/lib/claims.test.mjs` (new), for `bankProblem`.

**Interfaces:**
- **A `purchase`** takes `payBack` (`'float'` default, or `'finance'`) and the `bankName`, `accountNo` and `accountName` fields, and forwards them as `payBack` and `bank`.
- **Box 2** uploads as kind `pod`.
- **The desk and phone labels** for `pod` become "Receipt / Proof of work and product".

- [ ] Write the `bankProblem` tests, see them fail, implement, see them pass.
- [ ] Wire the route, then commit.

### Task 6: The job upload area on the phone and the computer

**Files:**
- `src/pages/FieldRepairsPage.tsx`;
- `src/pages/MaintenancePage.tsx`;
- `src/lib/portalI18n.ts` (four languages).

**Box 1, "Claim":**
- **The choice.** Segmented Petty Cash (Claim) / Direct Claim to Me. The default is Petty Cash, and it is hidden when `me.route` is `'finance'`.
- **What is required:**
  - the invoice photo;
  - the amount, read by OCR without waiting;
  - for Direct, the bank: a bank select, the account number and the name, prefilled from `GET /claims/my-bank` and editable. The note under it says "Changes here are kept on this claim only."
- **Submitting.** "Hand in" sends a `purchase`.

**Box 2, "Receipt / Proof of work and product":** an attach button for several files, store only.

**Removed:** the kind dropdown, on both screens.

- [ ] Build both screens.
- [ ] Check in the browser, against the local API with the claims forward stubbed or absent:
  - layout at 375 px and in dark mode;
  - the default choice;
  - the bank prefill shape;
  - Box 2 upload.
- [ ] Commit.

### Task 7: The phone Receipts page — three options

**Files:**
- `src/pages/FieldReceiptsPage.tsx`;
- `src/lib/portalI18n.ts`.

**Options:** Petty Cash (Claim), the default and hidden without a float; Direct Claim to Me; Direct Pay to Supplier.
- **Direct Claim to Me** adds the bank fields, as in Task 6, and hands in with `payBack: 'finance'`.
- **Direct Pay to Supplier:**
  - it asks for the supplier's name (prefilled from OCR), the amount, a "Pay by" date and the bill photo;
  - it posts to `/claims/requests` as `{ type: 'PAYMENT', payeeName, ... }`;
  - the bill is read with `readRequestBill`;
  - the success toast says "Sent to finance to pay the supplier".
- **Not waiting for OCR.** Send is enabled once the amount and the photo are there, even while reading.

- [ ] Build it, check it in the browser, commit.

### Task 8: SOP, checks and wrap-up

- [ ] SOP 6 gets the three options and the job boxes, in Chinese.
- [ ] Run `npm test`, `npm run check`, `npx tsc -b`, the engine tests (`npm run test:light` in `engine/backend`) and the engine frontend build.
- [ ] Add an "As built" section to this plan.
- [ ] Commit.
