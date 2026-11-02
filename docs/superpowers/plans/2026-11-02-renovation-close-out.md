# Renovation Close-out Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For every handed-over renovation project, the system checks the four close-out conditions in SOP 4.2.2 and shows what is still open. A project with all four done reads as Closed. Deposits are tracked by project or unit through the ordinary money documents.

**Architecture:**
- **Close-out check.** A pure close-out function works out the four conditions from data the engine already has: instalment bills and confirmed receipts, purchase orders and their bills and payments, the ledger's 330 deposit accounts by project, and the project's advance sub-account. The Renovation Projects page gets a Close-out tab and a "Not closed" alert.
- **Tagging.** For the deposit condition to be right, Money received lines and manual journal lines can name a project or a unit, as voucher lines already do.
- **Opening deposits.** A Ledger setup upload tags the opening 330 balances by project or unit. It is a reclassifying journal, so the account totals do not move.

**Tech Stack:** Hono engine, PostgREST `sb`, vitest with `fakeSb`, React + TanStack Query, migration in root `migrations-pg/`.

**Spec:** SOP 4.2.2 "结案和保修" (chew, 2026-10-20) and chew's answers on 2026-11-02:
- the deposit condition is read from the deposit accounts by project, not ticked by hand;
- deposits are recorded through vouchers and Money received, each naming its unit or project;
- the old deposits list will come from chew later, by deposit account.

## Global Constraints

**The four conditions** (SOP 4.2.2). A project is Closed only when all four hold. Each open condition shows in red with its amount.
1. **Billed and collected.**
   - Every instalment of the contract has its invoice.
   - The confirmed money received equals the revised contract.
   - Shown when open: "RM x not yet invoiced" and/or "RM x not yet received".
2. **Suppliers paid.**
   - Every live purchase order on the project is fully billed and every bill paid. This covers the 5% retention milestone, because the PO is not fully billed or paid until retention is.
   - Every AP invoice line on the project is paid.
   - Shown: "RM x owed to suppliers" and/or "RM x ordered, not billed".
3. **Building deposit returned.**
   - The project's balance on 330-0040 DEPOSIT - RENOVATION is zero.
   - Shown: "RM x deposit not returned".
   - When the opening deposits have not been uploaded yet (no OPENING-DEPOSITS journal) and the project was signed before the ledger start: "Deposit unknown: opening deposits not uploaded". Unknown is not closed.
4. **Advance cleared.** The project's advance sub-account (480/481-…) balance is zero. Shown: "RM x left in the advance".

**Which projects:** handed over (`projects.handed_over_at` set, or SO status RENO_COMPLETED) and not cancelled. A cancelled contract is not shown.

**Closed** is worked out on each read, as at today. It is not stored and nobody clicks it. The Renovation Projects table shows a "Not closed" alert on a handed-over project until all four hold.

**Tagging rules**
- A project or unit on Money received and manual journal lines follows the voucher's rules: a unit only on a Rental line, a project on any line, both optional.
- A receipt line naming a unit or project carries it to its ledger line.

**Opening deposits upload**
- Columns: Account (330-xxxx), Project code (or blank), Unit (building + unit number, or blank; exactly one of project and unit), Amount (RM), Paid to.
- It posts one journal, OPENING-DEPOSITS, dated the opening day:
  - for each row, Dr the account on its project or unit;
  - for each account, Cr the same account untagged for the rows' total.
- So every 330 account's total is unchanged.
- Refused when a row's account is not a 330-xxxx ASSET account, or when the rows for an account exceed that account's opening balance. Reversible like the opening journal.

**General:** screen text in British English. Next free migration number (0195 as of 2026-11-02; check prod and every branch first). Never DROP; new columns need no grants.

## Review Focus

1. **A deposit paid in part and kept in part.**
   - Pay RM 1,000 on 330-0040 for project P. Receive RM 800 back on P. Journal Dr project cost / Cr 330-0040 RM 200 on P.
   - The balance is 0 and the condition holds.
   - Without the journal it shows "RM 200 deposit not returned".
2. **Money for a project received on a sales order and on its invoices** counts once in "collected": confirmed SOPAY and SIPAY by receipt, as `renoProjectRows` already counts it.
3. **A reversal pair on a deposit line nets to nothing**, whatever its dates (`countsInTheBooks`).
4. **A project with no purchase orders and no deposit** passes conditions 2 and 3. Nothing owed is not "unknown".
5. **The opening-deposits upload cannot change an account's total.** The tagged Dr and the untagged Cr per account are equal. A second upload is refused until the first is reversed.

---

### Task 1: Tag Money received and manual journal lines

**Files:**
- `migrations-pg/0195_receipt_line_tags.sql`: `scm.acc_receipt_lines` add `project_id bigint`, `unit_id text`.
- `engine/backend/src/scm/routes/receipts.ts`:
  - `parseReceiptLine` takes `projectId` (a positive integer, refused if it is not a project of the company) and `unitId` (refused unless the line is Rental, or unknown in `conts_units`). Use the same refusal keys as vouchers: `unit_not_rental`, `unit_unknown`, `project_unknown`.
  - `receiptRuleLines` puts `projectId`/`unitId` on each Cr line; the bank's Dr lines carry none.
  - Stored on `acc_receipt_lines`.
- `engine/backend/src/scm/routes/accounting.ts` and `accounting-journal-edit.ts`: `JeLineIn` takes `projectId`, `unitId` with the same checks. Both create and edit pass them to `postJournal` and to a draft's lines.
- `engine/frontend/src/pages/scm-v2/Receipts.tsx` and `JournalEntries.tsx`: per line, a Project (`ProjectPicker`) and, on a Rental line, a Unit (`UnitPicker`). The view shows them as the voucher does.
- Tests:
  - `tests/receiptTags.test.ts`: a receipt line with a project → the JE Cr line has `project_id`; a unit on a Shared line → 400 `unit_not_rental`.
  - `tests/journalTags.test.ts`: a manual journal with a project on both lines → both JE lines carry it; an edit keeps it.
  - The frontend tests send `projectId`/`unitId`.
- [ ] Test first, then the code. Run the receipts, journal and voucher tests and `npx tsc -b` on both sides. Commit `feat(finance): Money received and journal lines can name a project or unit`.

### Task 2: Opening deposits upload

**Files:**
- `engine/backend/src/acc/opening-deposits.ts`: `importOpeningDeposits(sb, co, rows, actor)` and `reverseOpeningDeposits`; source type `OPENING_DEPOSITS`, doc `OPENING-DEPOSITS`.
- Routes beside the other opening routes, behind the post key.
- `engine/frontend/src/conts/openingDeposits.ts` (template and `readGrid` columns), plus a card on Ledger setup next to the other opening uploads.
  - Template columns: `Account`, `Project code`, `Building`, `Unit`, `Amount (RM)`, `Paid to`.
  - Units are matched by building and unit number against `/accounting/units`, projects by code against `/accounting/projects`; a row that matches nothing is refused with its row number.
- Tests in `tests/openingDeposits.test.ts`:
  - two rows on 330-0040 for projects 7 and 8 → the journal has Dr 330-0040 P7 1,000, Dr 330-0040 P8 500, Cr 330-0040 untagged 1,500, and the account total is unchanged;
  - a 620 account → refused;
  - rows above the account's opening balance → refused;
  - a second import → refused; reverse, then import again → allowed.
- [ ] Test first, then the code. Commit `feat(finance): opening deposits by project or unit`.

### Task 3: The close-out check and its tab

**Files:**
- `engine/backend/src/acc/reno-close-out.ts`:
  - `closeOutOf(input): { closed: boolean; checks: Array<{ key: 'billed' | 'suppliers' | 'deposit' | 'advance'; ok: boolean | null; text: string }> }`, pure. `ok: null` means unknown.
  - `renoCloseOutRows(sb, co, asOf)`: the handed-over projects with their checks. It reuses `renoProjectRows` for the money, cost, supplier and advance figures. It adds the instalment-billed check from `reno_doc_instalments` against `reno_instalment_bills`, and the 330-0040 balance by `project_id` (counted with `countsInTheBooks`).
- `GET /accounting/reno-close-out` (Ledger guard).
- `acc/reno-projects.ts`: `RenoProjectRow.notClosed: boolean` (handed over and any check not ok). `alertsOf` adds "Not closed".
- `engine/frontend/src/conts/RenoCloseOut.tsx`:
  - a Close-out tab on Renovation Projects;
  - one row per handed-over project: Project, Customer, Handover, four check columns (a green "Done" or the red text from `checks[].text`) and Status (Closed / Open);
  - filter Open / Closed / All, default Open; Excel export.
- Tests:
  - `src/acc/reno-close-out.test.ts`:
    - all four done → closed;
    - each failing alone gives its text (amounts in RM: "RM 1,234.00 not yet received");
    - deposit unknown when the contract was signed before the ledger start and no OPENING-DEPOSITS exists;
    - the deposit case from Review Focus 1;
    - no POs and no deposit → conditions 2 and 3 ok.
  - Frontend: the tab lists rows and the filter works.
- [ ] Test first, then the code. Update SOP 4.2.2 with the dated paragraph on deposits by account and the automatic Closed. Commit `feat(renovation): close-out check on Renovation Projects`.

### Task 4: Ship

- [ ] Run the full backend suite. Known failures on main: doStockLeavesOnConfirm, renovationRecords, renovationTimeline, settlementRoutes, soLineFreezeRoutes, specialsRecordedNeverPriced.
- [ ] Have a fresh reviewer go over the branch, and fix the findings test-first.
- [ ] Apply 0195 to production with its `pos_migrations` row, then open the PR, merge it and watch the deploy.
- [ ] Add every new screen to the Property OS Finance menu. None is expected: the Close-out tab sits inside Renovation Projects.
