# My Claims: One Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My claims has one form to hand something in.
- It starts with **Claim to me** (I paid, pay me back) or **Direct pay** (finance pays a supplier: a payment or a deposit).
- Staff never choose the account.
- The department comes from the person and cannot be changed.
- Suppliers are picked from a searchable table.

**Architecture:**
- **Property OS** (`src/pages/MyClaimsPage.tsx`): the "Hand in a receipt" and "Ask finance to pay" tabs become one form with a switch. "Mine" stays.
- **Engine** (`engine/backend/src/conts/claims-lines.ts`, `my-claims-routes.ts`):
  - a claim line's department is always worked out from the person (or Rental for a maintenance job), whatever the client sends;
  - no submitter's account is kept;
  - the suppliers list returns every supplier when nothing is typed.
- Finance keeps choosing the account (and may correct the department) when checking a receipt or making a voucher from a request, as today.

**Tech Stack:** Property OS React + Pages Functions (forwarding `/api/claims/*`), engine Hono + vitest.

**Spec:** chew, 2 Nov 2026:
- "做在一起 submit，submit 时选 claim to me or direct pay";
- "choose the kind of cost 不可能由他们选";
- "department 到时是根据 user 去选";
- "我没看到 choose 什么 supplier" (the list only filled after typing two letters in another box).

## Global Constraints

**The switch.** At the top of the form, "What is this?":
- **Claim to me**: "I paid. Pay me back."
- **Direct pay**: "Finance pays a supplier." Under Direct pay, a second switch: **A payment** (a bill to pay) / **A deposit** (paid before the bill; to a listed supplier only).

**Claim to me** (today's receipt form, unchanged otherwise):
- receipt files (required), date, amount, shop (optional, filled by OCR);
- For (none / unit / job / project), description, split lines, note;
- the float note as today ("Your department has no petty cash: finance pays you back by bank transfer." or the float's name).

**Direct pay** (today's request form):
- supplier, or a PO, or "Not on the list" with a payee name — never for a deposit;
- amount, the date it is wanted by, bill files (optional), For, description, note.

**No account and a fixed department, on both kinds**
- No "What it is" field.
- The line's department shows as read-only text, e.g. "Department: Renovation (from your department)". There is no picker on a line.
- A maintenance job line reads "Rental".
- The server ignores any department or account the client sends: department = Rental for a job line, else `lineDepartment(staff.side)`; account = null.

**Supplier picker.** A button showing the chosen supplier (or "Choose the supplier…") opens a searchable table (Code, Name) of every supplier of the company, as the voucher's project picker does.
- Typing narrows on code and name.
- "Not on the list" sits as the table's first row, for a payment only.
- The PO picker stays as it is.

**Unchanged.** Mine tab; field staff (phone and maintenance "My purchase"); the finance screens.

**Wording.** British English on screen.

## Review Focus

1. **An old client cannot slip a department or an account in.**
   - A POST to `/receipts` or `/requests` with `department: 'supply'` and `accountCode: '620-0010'` from a staff member on The Conts side stores `rental` and no account.
   - A maintenance job line stays `rental`.
2. **Finance can still set the account and change the department when checking**, so a receipt saved with no account can be checked and paid. Today's check route requires an account per line; the screen must offer it, as it does now.
3. **A deposit with "Not on the list" is refused**, on screen and by the server, as today.
4. **The supplier table with many suppliers:**
   - the list returns all suppliers of the company (paginated server-side, capped at 5,000);
   - the table filters in the browser;
   - another company's suppliers never show.
5. **Switching between Claim to me and Direct pay keeps what is common** (amount, For, description, note) and drops what is not (receipt files vs. supplier).

---

### Task 1: Server — department from the person, no submitter account, all suppliers

**Files:**
- `engine/backend/src/conts/claims-lines.ts`: `buildLines` sets `department` to `job ? 'rental' : lineDepartment(staff.side)` and `account_code` to `null` for everyone.
- `engine/backend/src/conts/my-claims-routes.ts`: `suppliersHandler` with no `q` returns every supplier of the company (code, name), paginated with `paginateAll`, ordered by name, capped at 5,000.
- Tests in the claims test files:
  - an office POST with `department: 'supply', accountCode: '620-0010'` from a Conts-side person stores `rental`, null;
  - a job line is `rental`;
  - a Both-side person's line is `shared`;
  - `/suppliers` with no `q` lists all of the company's, not another company's.
- [ ] Test first, then the code. Commit `fix(claims): a claim's department comes from the person; staff choose no account; all suppliers listed`.

### Task 2: One form in Property OS

**Files:**
- `src/pages/MyClaimsPage.tsx`:
  - tabs **Hand in** / **Mine**;
  - the Hand in form has the switch, then the Claim to me fields or the Direct pay fields;
  - `LinesEditor` loses "What it is" and the department picker and shows the department as text;
  - a `SupplierPicker` (modal table) replaces the supplier select and the "Find the supplier or PO" box. PO search keeps its own box.
- Checks: `node scripts/checks/run.mjs`, `npm test`, `npx tsc --noEmit`, and `scripts/api-checks` for claims if one covers the form.
- [ ] Build, check at phone width and on desktop in the preview, commit `feat(claims): one form — Claim to me or Direct pay`.

### Task 3: Ship

- [ ] Engine first:
  - full backend suite (known failures on main: doStockLeavesOnConfirm, renovationRecords, renovationTimeline, settlementRoutes, soLineFreezeRoutes, specialsRecordedNeverPriced);
  - `tsc -b`;
  - PR, merge, watch the deploy.
- [ ] Then Property OS: PR, wait for its checks (property-os, rbac), merge, watch the deploy.
- [ ] Have a fresh reviewer go over both, and fix the findings test-first.
