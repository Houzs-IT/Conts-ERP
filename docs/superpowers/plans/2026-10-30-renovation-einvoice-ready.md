# Renovation e-invoice ready (switched off) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every renovation invoice and credit note gets an LHDN-shaped e-invoice record waiting in an outbox. Nothing is sent: a company switch stays off until chew connects MyInvois.

**Architecture:**
- Seller details, codes and the switch live on `scm.acc_company_settings`. The buyer's tax identity (TIN, ID type and number, SST number) lives on `scm.debtors`, one row per project account.
- A pure builder turns an invoice or credit note plus those details into a MyInvois v1.1-shaped JSON payload, or a list of what is missing.
- An outbox table keeps one row per document. Its status is NOT_READY (something missing) or READY. It is prepared when the document posts and refreshed when the customer's details change.
- A finance page shows the settings and the outbox.

**Tech Stack:** Hono engine (`engine/backend`), PostgREST `sb` + SQL `RenoDb`, vitest, React + TanStack Query (`engine/frontend`).

**Spec:** `docs/superpowers/specs/2026-10-30-renovation-revenue-einvoice-design.md` (Goal 7; sections 4, 7.4, 7.7). Also SOP `docs/finance/FINANCE-SOP.md` 4.2 and 4.2.1.

## Global Constraints

- **Scope.** Renovation only: sales invoices whose SO is a renovation contract (`scm.reno_so_contracts` row) and credit notes with `renovationCreditKind` ≠ null. Furniture and rental are out of scope.
- **Nothing is ever sent.** There is no connector code. `einvoice_active` only changes what the screens say and warn.
- **Do not block saving.** Billing, crediting and posting never fail because e-invoice details are missing. They prepare a NOT_READY row and, when active is on, return a warning (chew: "别 block 他们保存").
- **One line per e-invoice.** Its description is the invoice line's description, at most 300 characters.
- **Defaults:**
  - classification `022` (Others);
  - tax type `06` (Not applicable);
  - SST off;
  - currency `MYR`;
  - country `MYS`.
- **Description template default.** It reproduces chew's example exactly: `1st Progress Billing for Interior Design & Renovation Works (15% Deposit & Design Fee as per Sales Order, refer to attached breakdown)`.
- **Text and data rules:**
  - product text in English (British);
  - every new table is granted to `service_role` and `pos_app`;
  - production SQL never uses DROP (use `add column if not exists`, `create or replace`).
- **Migrations:**
  - root `migrations-pg/`, next free number;
  - check production `public.pos_migrations` and every remote branch first (0187 is free on 30 Oct 2026);
  - apply by hand on production with its `pos_migrations` row (sha256 of the LF-normalised file, first 16 hex).
- **Before merging** run `npx tsc -b` in `engine/backend` and `engine/frontend`.

## Review Focus

1. **Malaysian individual with only a MyKad.** Expect buyer TIN `EI00000000010` with ID type NRIC and the IC number. Expect READY, not "missing TIN". Pinned in Task 3: `individual with NRIC only uses general TIN`.
   - Before Task 3 ships, check this rule against the current LHDN e-Invoice Specific Guideline (General TIN section). Also check the foreign-buyer rule: `EI00000000020` with a passport.
2. **Customer details filled in after the invoice was billed.** The outbox row must turn READY without re-billing. Pinned in Task 5: `refreshForDebtor turns NOT_READY rows READY`.
3. **Invoice or credit note cancelled before it is ever sent.** Its outbox row becomes CANCELLED and drops out of the "waiting" count. Pinned in Task 5: `cancelled invoice cancels its outbox row`.
4. **Description longer than 300 characters.** This happens with a long instalment label or contract number. The template must fit, so cut the label, never the fixed words. Pinned in Task 4: `description never exceeds 300 characters`.
5. **Address state written in free text** ("W.P. Kuala Lumpur", "KL", "Selangor Darul Ehsan"). It must map to LHDN state codes 01–17. Anything unknown makes the row NOT_READY with `buyer state`; never guess. Pinned in Task 3: `state names map to LHDN codes`.

---

## PR plan

| PR | Tasks | Holds |
|---|---|---|
| 1 | 1, 2 | Migration, settings module, debtor tax identity (API + Debtors screen) |
| 2 | 3, 4, 5 | Builder, description template, outbox and its hooks |
| 3 | 6, 7 | Routes and the E-invoice page |

---

### Task 1: Migration and e-invoice settings

**Files:**
- Create: `migrations-pg/0187_einvoice_ready.sql`
- Create: `engine/backend/src/acc/einvoice-settings.ts`
- Test: `engine/backend/src/acc/einvoice-settings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EInvoiceSettings {
    active: boolean;
    classificationCode: string;        // '022'
    taxType: string;                   // '06'
    sstEnabled: boolean;               // false; stored only, no postings
    sstMode: 'EXCLUSIVE' | 'INCLUSIVE' | null;
    sstOutputAccount: string | null;
    renoDescriptionTemplate: string;
    seller: { tin: string; brn: string; sstNo: string; msicCode: string; activityDesc: string;
              address1: string; address2: string; city: string; postcode: string; stateCode: string; phone: string; email: string };
  }
  export const DEFAULT_RENO_DESCRIPTION =
    '{ordinal} Progress Billing for Interior Design & Renovation Works ({pct} {label} as per Sales Order, refer to attached breakdown)';
  export const EINVOICE_DEFAULTS: EInvoiceSettings;
  export const TAX_TYPES: Record<string, string>;   // '01' Sales Tax … '06' Not applicable, 'E' Tax exemption
  export async function loadEInvoiceSettings(sb: Sb, companyId: number): Promise<EInvoiceSettings>;
  export function validateEInvoiceSettings(s: EInvoiceSettings): { ok: true } | { ok: false; field: string; message: string };
  export function sellerMissing(s: EInvoiceSettings): string[];
  export async function saveEInvoiceSettings(sb: Sb, companyId: number, s: EInvoiceSettings, actor: string): Promise<{ ok: true } | { ok: false; field: string; message: string }>;
  ```
- `sellerMissing` returns labels such as `'seller TIN'`.

**Migration.**
- Columns on `scm.acc_company_settings`, all `add column if not exists`:
  - `einvoice_active boolean not null default false`
  - `einvoice_classification text not null default '022'`
  - `einvoice_tax_type text not null default '06'`
  - `sst_enabled boolean not null default false`
  - `sst_mode text`
  - `sst_output_account text`
  - `reno_invoice_description text`
  - `seller_tin`, `seller_brn`, `seller_sst_no`, `seller_msic`, `seller_activity`
  - `seller_address1`, `seller_address2`, `seller_city`, `seller_postcode`, `seller_state_code`
  - `seller_phone`, `seller_email` (all `text`)
- On `scm.debtors`: `tin text`, `id_type text` (check in NRIC, BRN, PASSPORT, ARMY), `id_number text`, `sst_no text`.
- The outbox table is in Task 5's interface but is created in this migration.
- Table `scm.acc_einvoice_outbox`:
  - `id uuid pk default gen_random_uuid()`
  - `company_id int not null`
  - `doc_kind text not null check in ('INVOICE','CREDIT_NOTE')`
  - `sales_invoice_id uuid`, `credit_note_id uuid`, `doc_number text not null`
  - `debtor_code text`
  - `status text not null check in ('NOT_READY','READY','SUBMITTED','VALID','REJECTED','CANCELLED')`
  - `missing text[] not null default '{}'`
  - `payload jsonb`
  - `prepared_at timestamptz not null default now()`
  - `submitted_at timestamptz`
  - `lhdn_uuid text`, `lhdn_long_id text`, `error text`
  - unique `(company_id, doc_kind, doc_number)`
- Grants as the rule.

- [ ] **Step 1: Write the failing tests** in `einvoice-settings.test.ts`:
  - `defaults are 022, 06, SST off, inactive`: `EINVOICE_DEFAULTS` has `classificationCode '022'`, `taxType '06'`, `sstEnabled false`, `active false`.
  - `default template is the placeholder sentence`: `EINVOICE_DEFAULTS.renoDescriptionTemplate === DEFAULT_RENO_DESCRIPTION`, the constant defined in this file (text in Task 4). Rendering it is tested in Task 4.
  - `rejects classification that is not three digits`: `'22'` gives `{ok:false, field:'classificationCode'}`.
  - `rejects unknown tax type`: `'07'` is refused.
  - `refuses switching SST on`: `sstEnabled: true` gives `{ok:false, field:'sstEnabled', message:'SST postings are not built yet. Leave SST off until they are.'}`.
  - `refuses active while seller details are missing`: `active: true` with an empty seller gives `field:'active'`, and the message lists `sellerMissing`.
  - `MSIC must be five digits; seller TIN shape C/IG + digits`: refuses `'4330'` and `'12345'`.
- [ ] **Step 2: Run them to see them fail.** Command: `cd engine/backend && npx vitest run src/acc/einvoice-settings.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Write the migration and implement `einvoice-settings.ts`.**
  - Follow `acc/ledger-settings.ts` (load/save one row per company, upsert on `company_id`).
  - Seller TIN check: `^(C|IG|D|E|F|FA|PT|TA|TC|TN|TR|TP|J|LE)\d{8,12}0?$` — loose. An unusual TIN must not lock finance out.
- [ ] **Step 4: Run the tests to see them pass.** Same command, expected PASS.
- [ ] **Step 5: Commit.** `feat(einvoice): settings and outbox schema (migration 0187)`

### Task 2: Customer tax identity on project accounts

**Files:**
- Modify: `engine/backend/src/conts/debtors-routes.ts` (`createDebtorHandler`, `patchDebtorHandler`, list select)
- Modify: `engine/frontend/src/conts/debtorQueries.ts` (`Debtor`, `DebtorInput`)
- Modify: `engine/frontend/src/conts/Debtors.tsx` (edit form section "E-invoice")
- Test: `engine/backend/src/conts/debtors-routes.test.ts`, `engine/frontend/src/conts/Debtors.test.tsx`

**Interfaces:**
- Produces: `Debtor` gains `tin: string | null; idType: 'NRIC'|'BRN'|'PASSPORT'|'ARMY'|null; idNumber: string | null; sstNo: string | null`. The PATCH body accepts the same keys.
- Task 2 only stores the fields. Task 5 adds the refresh call to `patchDebtorHandler`.

- [ ] **Step 1: Write the failing tests.**
  - Backend:
    - `patch stores tin, id type and number, sst no`;
    - `NRIC must be 12 digits (dashes stripped)`: `'900101-14-5678'` is stored as `'900101145678'`, and `'12345'` gets 400 `invalid_id_number`;
    - `BRN accepts 12-digit new format`;
    - `unknown id type refused`.
  - Frontend: `edit form shows E-invoice fields and saves them`.
- [ ] **Step 2: Run them to see them fail.** `cd engine/backend && npx vitest run src/conts/debtors-routes.test.ts` and `cd engine/frontend && npx vitest run src/conts/Debtors.test.tsx`.
- [ ] **Step 3: Implement.**
  - Empty strings are stored as null.
  - The form labels are "Tax ID (TIN)", "ID type", "ID number" and "SST registration no."
  - Hint under TIN: "Individuals without a TIN: leave blank and give the MyKad number."
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(einvoice): tax identity on customer accounts`

**PR 1:** open it after a fresh review, with the migration applied on production before the merge.

---

### Task 3: E-invoice payload builder (pure)

**Files:**
- Create: `engine/backend/src/acc/einvoice-build.ts`
- Test: `engine/backend/src/acc/einvoice-build.test.ts`

**Interfaces:**
- Consumes: `EInvoiceSettings` (Task 1).
- Produces:
  ```ts
  export interface EInvoiceDoc {
    kind: 'INVOICE' | 'CREDIT_NOTE';
    number: string; date: string;            // YYYY-MM-DD
    description: string; amountSen: number;  // positive
    references: string[];                    // credit note: the contract's invoice numbers it adjusts
  }
  export interface EInvoiceBuyer {
    name: string; tin: string | null; idType: string | null; idNumber: string | null; sstNo: string | null;
    address1: string | null; address2: string | null; city: string | null; postcode: string | null; state: string | null;
    country: string | null; phone: string | null; email: string | null;
  }
  export type BuildResult = { ok: true; payload: Record<string, unknown> } | { ok: false; missing: string[]; payload: Record<string, unknown> };
  export function buildEInvoice(doc: EInvoiceDoc, buyer: EInvoiceBuyer, s: EInvoiceSettings): BuildResult;
  export function lhdnStateCode(state: string | null): string | null;
  ```
- The payload is plain JSON in MyInvois v1.1 field names, not UBL wrapping:
  - `invoiceTypeCode`: `'01'` for an invoice, `'02'` for a credit note;
  - `id`, `issueDate`, `currency 'MYR'`;
  - `supplier{…}`, `buyer{…}`;
  - `lines[1]{classification, description, unitPrice, quantity:1, subtotal, taxType, taxAmount:0, totalExcludingTax}`;
  - `totals{excludingTax, includingTax, payable}`;
  - `billingReferences` (credit note).
  - The UBL conversion belongs to the connector, later.

- [ ] **Step 1: Write the failing tests:**
  - `invoice with full buyer is READY`: one line, classification `'022'`, taxType `'06'`, amounts in RM with 2 decimals (`1000000` sen gives `10000.00`).
  - `individual with NRIC only uses general TIN`: tin null, NRIC given → `buyer.tin === 'EI00000000010'`, `buyer.idType === 'NRIC'`, ok.
  - `foreign buyer with passport uses EI00000000020`: `country !== 'MYS'`, PASSPORT.
  - `missing items listed in plain words`: no phone, no address, no ID → `missing` equals `['buyer ID number', 'buyer address', 'buyer phone']` (order fixed: TIN/ID, address, state, phone, then seller items from `sellerMissing`).
  - `buyer SST defaults to NA`.
  - `credit note carries type 02 and its references`.
  - `state names map to LHDN codes`:
    - "Selangor" and "SELANGOR DARUL EHSAN" give `'10'`;
    - "Kuala Lumpur", "W.P. Kuala Lumpur" and "KL" give `'14'`;
    - "Johor" gives `'01'`;
    - "Penang" and "Pulau Pinang" give `'07'`;
    - "Putrajaya" gives `'16'`;
    - "Labuan" gives `'15'`;
    - "Mars" gives `null`, so `missing` includes `'buyer state'`.
  - `description over 300 characters is a missing item, never cut here`: the builder refuses, Task 4 makes sure it never happens.
- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/acc/einvoice-build.test.ts`.
- [ ] **Step 3: Implement.** The state table is LHDN's state codes 01–17: Johor 01, Kedah 02, Kelantan 03, Melaka 04, Negeri Sembilan 05, Pahang 06, Pulau Pinang 07, Perak 08, Perlis 09, Selangor 10, Terengganu 11, Sabah 12, Sarawak 13, WP Kuala Lumpur 14, WP Labuan 15, WP Putrajaya 16, Not applicable 17. Match case-insensitively after stripping "W.P.", "Wilayah Persekutuan", "Darul …" suffixes and punctuation.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(einvoice): payload builder`

### Task 4: Invoice description from a template

**Files:**
- Create: `engine/backend/src/scm/lib/reno-invoice-description.ts`
- Modify: `engine/backend/src/scm/lib/renovation-billing.ts` (`billInstalment`: the `label` / `Progress billing: …` text on the invoice header `notes` and item `description`; also the negative-instalment credit note line)
- Test: `engine/backend/src/scm/lib/reno-invoice-description.test.ts`, existing `renovation-billing` tests

**Interfaces:**
- Produces:
  ```ts
  // DEFAULT_RENO_DESCRIPTION lives in acc/einvoice-settings.ts (Task 1); its text is:
  // '{ordinal} Progress Billing for Interior Design & Renovation Works ({pct} {label} as per Sales Order, refer to attached breakdown)'
  export function ordinal(n: number): string;   // 1st 2nd 3rd 4th … 11th 12th 13th 21st
  export function renderRenoDescription(tpl: string | null, v: { seq: number; pctBp: number; label: string; soDocNo: string }): string;
  ```
- Placeholders: `{ordinal}`, `{seq}`, `{pct}` (e.g. `15%`, `12.5%`), `{label}` (the instalment's label, e.g. "Deposit & Design Fee"), `{so}`.
- A null or blank template renders `DEFAULT_RENO_DESCRIPTION`.

- [ ] **Step 1: Write the failing tests:**
  - `chew's example`: `renderRenoDescription(null, {seq:1, pctBp:1500, label:'Deposit & Design Fee', soDocNo:'SO-1'})` equals the Global Constraints sentence.
  - `ordinals`: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd.
  - `description never exceeds 300 characters`: with a 400-character label, the result is ≤ 300 and still starts with `'1st Progress Billing for'` and ends with `'refer to attached breakdown)'`. Only the label is shortened, with `'…'`.
  - `empty label drops cleanly`: no double spaces.
  - In the billing test: `billed invoice line uses the template`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - `billInstalment` loads the company's template (`loadEInvoiceSettings(...).renoDescriptionTemplate`, through the `db` runner: a plain `select reno_invoice_description from scm.acc_company_settings where company_id=$1`).
  - It uses the rendered text for both the invoice `notes` and the item `description`.
  - The negative-instalment credit note line says `Credit: ` + the same text.
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(einvoice): renovation invoice description template`

### Task 5: Outbox — prepare, refresh, cancel

**Files:**
- Create: `engine/backend/src/acc/einvoice-outbox.ts`
- Modify: `engine/backend/src/scm/lib/post-si-revenue.ts` (after `postRenovationInvoice` succeeds; on the cancel path next to `releaseInvoiceAllocations`)
- Modify: `engine/backend/src/acc/credit-notes.ts` (after `postRenovationCredit` succeeds; on cancel next to `releaseRenovationCredit`)
- Modify: `engine/backend/src/conts/debtors-routes.ts` (`patchDebtorHandler` calls `refreshForDebtor` when tin / idType / idNumber / sstNo / phone / name changed)
- Modify: `engine/backend/src/acc/einvoice-settings.ts` (`saveEInvoiceSettings` calls `refreshAll` when seller fields change)
- Test: `engine/backend/src/acc/einvoice-outbox.test.ts`

**Interfaces:**
- Consumes: `buildEInvoice`, `loadEInvoiceSettings`.
- Produces:
  ```ts
  export type OutboxStatus = 'NOT_READY' | 'READY' | 'SUBMITTED' | 'VALID' | 'REJECTED' | 'CANCELLED';
  // null = not a renovation document, nothing prepared
  export async function prepareInvoice(sb: Sb, companyId: number, salesInvoiceId: string): Promise<{ status: OutboxStatus; missing: string[] } | null>;
  export async function prepareCreditNote(sb: Sb, companyId: number, creditNoteId: string): Promise<{ status: OutboxStatus; missing: string[] } | null>;
  export async function cancelOutbox(sb: Sb, companyId: number, kind: 'INVOICE' | 'CREDIT_NOTE', docNumber: string): Promise<void>;
  export async function refreshForDebtor(sb: Sb, companyId: number, debtorCode: string): Promise<number>;  // rows re-prepared
  export async function refreshAll(sb: Sb, companyId: number): Promise<number>;
  ```
- **Buyer details.** The name comes from the debtor. TIN, ID and SST come from `scm.debtors` (by `debtor_code`). Address and phone come from the invoice's own columns (`address1, address2, city, postcode, state, phone, email`). For a credit note they come from the SO.
- **Credit note references.** The contract's non-cancelled invoice numbers dated on or before the note date (`sales_invoices where so_doc_no = note.so_doc_no`).
- **Re-preparing.** It only touches rows in NOT_READY or READY. SUBMITTED / VALID / REJECTED rows are left as they are.
- **Errors.** A hook failure is logged and never undoes the posting (try/catch around the prepare call, as for other after-posting steps in `post-si-revenue.ts`).

- [ ] **Step 1: Write the failing tests** (in-memory `sb` fake, as other `acc/*.test.ts` do):
  - `prepares a READY row for a renovation invoice with full details`;
  - `prepares NOT_READY with missing list when debtor has no ID`;
  - `non-renovation invoice is skipped`: no row, returns `null`;
  - `preparing twice updates the same row`;
  - `refreshForDebtor turns NOT_READY rows READY`;
  - `cancelled invoice cancels its outbox row`;
  - `submitted rows are never re-prepared or cancelled`;
  - `credit note row references the contract's invoices`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement and wire the hooks.**
  - When `einvoice_active` is on and the result is NOT_READY, the billing response (`billInstalment` route) and the credit-note post response carry `einvoiceWarning: 'E-invoice not ready: <missing joined>. The invoice is saved; fill in the customer's details.'`.
- [ ] **Step 4: Run them to see them pass.** Also run the existing `post-si-revenue`, `credit-notes` and `renovation-billing` tests.
- [ ] **Step 5: Commit.** `feat(einvoice): outbox prepared on posting, refreshed on detail changes`

**PR 2:** open it after a fresh review.

---

### Task 6: Routes

**Files:**
- Create: `engine/backend/src/acc/einvoice-routes.ts`
- Modify: `engine/backend/src/scm/routes/accounting.ts` (mount)
- Test: `engine/backend/src/acc/einvoice-routes.test.ts`

**Interfaces:**
- `GET /scm/accounting/einvoice/settings` returns `EInvoiceSettings & { sellerMissing: string[] }`.
- `PUT /scm/accounting/einvoice/settings` returns 200, or 400 `{error:'invalid_setting', field, message}`.
- `GET /scm/accounting/einvoice/outbox?status=&q=&page=` returns `{ rows: Array<{ id, docKind, docNumber, debtorCode, debtorName, date, amountSen, status, missing }>, counts: Record<OutboxStatus, number> }`.
- `GET /scm/accounting/einvoice/outbox/:id` returns the row with its `payload`.
- `POST /scm/accounting/einvoice/outbox/refresh` returns `{ refreshed: number }` (calls `refreshAll`).
- Who can do what: finance roles only, the same guard as the Ledger setup routes. Reading is for finance; saving settings is for the finance owner/admin, as `ledger-settings` saving is.

- [ ] **Step 1: Write the failing tests:**
  - `non-finance user gets 403`;
  - `PUT refuses SST on with the message from Task 1`;
  - `outbox lists counts by status`;
  - `refresh re-prepares NOT_READY rows`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.**
- [ ] **Step 5: Commit.** `feat(einvoice): settings and outbox routes`

### Task 7: E-invoice page

**Files:**
- Create: `engine/frontend/src/conts/EInvoice.tsx`, `engine/frontend/src/conts/einvoiceQueries.ts`
- Modify: the finance menu and router, the same way `LedgerSetup` is registered (find it with `grep -rn "LedgerSetup" engine/frontend/src --include=*.tsx`)
- Modify: the renovation billing screen, where `billInstalment`'s result is shown, to show `einvoiceWarning` as a warning toast
- Test: `engine/frontend/src/conts/EInvoice.test.tsx`

**Layout** (follow the `dashboard-design` skill for the table; reuse the project's existing table, card and form components):
- **Header:** "E-invoice". Status pill "Off — nothing is sent" or "On — waiting for the MyInvois connection". Neither state sends anything.
- **Card "Status":**
  - three counts: Ready, Not ready, Cancelled;
  - a "Re-check all" button (POST refresh).
- **Card "Settings":**
  - **Seller block:** TIN, BRN, SST no. (blank = "NA"), MSIC code, business activity, address, phone, email.
  - **Codes:** classification (default 022) and tax type (select from `TAX_TYPES`, default 06).
  - **SST:** a switch, shown disabled, with the note "SST postings are not built yet".
  - **Template:** the invoice description template with placeholders help and a live preview for "1st, 15%, Deposit & Design Fee".
  - **Active:** the "E-invoice active" switch, with the refusal message shown in place.
- **Card "Outbox":**
  - table columns: Document, Date, Customer, Amount (RM, right-aligned), Status, What is missing;
  - filter by status;
  - a row opens a side panel with the payload as formatted JSON;
  - Not-ready rows link to the customer account (Debtors screen) to fill in the details.

- [ ] **Step 1: Write the failing tests:**
  - `shows counts and outbox rows`;
  - `saving settings sends the form`;
  - `SST switch is disabled`;
  - `template preview renders chew's example`;
  - `not-ready row shows what is missing`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.** Run `npx tsc -b` in `engine/frontend`.
- [ ] **Step 5: Commit.** `feat(einvoice): E-invoice page`

**PR 3:** open it after a fresh review, merge, then watch the deploy.

---

## SOP

Within PR 3, update SOP 4.2.1 with one paragraph on the e-invoice:
- every renovation invoice and credit note is prepared for e-invoice;
- finance fills in the customer's TIN or ID on the customer account;
- the E-invoice page shows what is ready;
- nothing is sent until chew switches it on after connecting MyInvois.

## Calls made in this plan (check them)

- **One seller.** Dream Crafter and The Conts are one company (one chart: 480 and 481 are in the same ledger), so both brands issue under one seller TIN. If Dream Crafter is a separate legal entity, the seller block must move per brand. **Ask chew before Task 1.**
- **General TIN for individuals.** A buyer with only a MyKad gets the general TIN `EI00000000010` plus their IC number; a foreign buyer gets `EI00000000020` with a passport. Verify against LHDN's guideline before Task 3 ships.
- **Credit note references.** A credit note references all of the contract's invoices up to its date. A contract credit is not tied to one invoice.
- **Where the address comes from.** The invoice's own address (copied from the SO) is used, not a new address on the customer account.
- **What "active" does.** Turning it on only changes the page and the warnings at billing. Sending is built with the connector.
- **Payload shape.** The stored payload is MyInvois-shaped JSON, not signed UBL. Signing and UBL belong to the connector.
