# Sub-departments (chew, 4 Nov 2026)

Status: agreed with chew in chat on 4 Nov 2026, open questions answered the same day. Nothing is built yet. Business rules: SOP 1.1 (new), 3.2, 6.

## Why

The ledger has three departments: Rental, Renovation (stored as `supply`) and Company (`shared`). chew wants to see
spending one level down:

- **Renovation** is two brands. Dream Crafter does customer renovation; The Conts does in-house renovation. A
  Renovation cost with no project (team wages, tools, petrol) cannot say which brand it belongs to today.
- **Rental** has a Maintenance team and a Cleaning team. chew wants each team's spending, while the P&L still shows
  them under Rental.

## chew's decisions

1. **Two levels.** Each line names a sub-department, and the department follows from it. The departments, which are
   the P&L columns, stay fixed.

   | Department | Sub-departments at start | Staff department it maps to |
   |---|---|---|
   | Rental (`rental`) | Rental (general), Maintenance, Cleaning | other Rental staff; Maintenance; Cleaning |
   | Renovation (`supply`) | Renovation (Dream Crafter), In-house Reno (The Conts) | other Supply chain staff; In-house Renovation |
   | Company (`shared`) | Company | none |

2. **The renovation sub-department comes first, then the project.**
   - The project picker lists only that brand's projects. The brand is the project's type: `finance_kind`, else its
     brand's (SOP 2.1).
   - With a project, the line is the project's cost and counts against its limit.
   - With no project, the line is that sub-department's own cost and counts against no limit.
   - This replaces the 2 Nov rule that a Renovation line must name a project.
3. **Every document**: payment vouchers, staff receipts (petty cash), payment requests, AP invoices and manual
   journals.
4. **chew maintains the list** on Ledger setup (option A):
   - Add a sub-department under a department (for example Laundry under Rental), rename one, or retire one.
   - Map each sub-department to a staff department.
   - The two renovation sub-departments are tied to the brands. They can be renamed, never retired.
5. **Defaults, all changeable on the line:**
   - A staff document (receipt, payment request) takes the sub-department mapped to the submitter's staff department.
   - A receipt paid from a float takes the float's department. Cleaning (315-0040) gives Cleaning; Maintenance
     (315-0101) gives Maintenance. This holds even when the receipt has no unit.
   - A maintenance-job cost takes Maintenance, and the job's unit.
   - Finance's own documents have no default. A new line takes the line above.
6. **Units on Maintenance and Cleaning lines, where possible.**
   - The unit field comes first.
   - A line can still be saved with no unit. It shows "No unit", and a report lists those lines.
7. **Department and unit are two tags on one line; the money counts once.**
   - Department reports show the line under its sub-department.
   - Rental Unit Costs shows it under its unit, with the sub-department beside it.
   - A unit is still finance only and never charges the owner.
8. **Reports.**
   - The P&L keeps one column per department. Each department shows its sub-departments, which add up to its total.
   - Any department report can be narrowed to one sub-department.
9. **Existing records.**
   - Nothing was booked before 1 Nov 2026.
   - Lines from 1 Nov on are tagged once, at go-live:
     - a maintenance job gives Maintenance;
     - a float gives the float's department;
     - a renovation project gives its brand by type;
     - anything else becomes Rental (general) or Renovation (Dream Crafter), which finance can change line by line.

## Design

### Data

- New table `scm.acc_sub_departments`:
  - `id`, `company_id`, `department` (`rental` / `supply` / `shared`), `name`;
  - `fixed_key`: `rental_general`, `dreamcrafter`, `theconts`, `company`, or null for chew's own;
  - `staff_department_id`: maps to `public.conts_departments`, nullable;
  - `active`, `sort`.

  The fixed keys are seeded. Maintenance and Cleaning are seeded too, as ordinary rows mapped to the staff
  departments of those names.
- **`department` stays exactly as it is.** It keeps the same column, check constraint and values on every line table.
  A new nullable column `sub_department_id` sits beside it on:
  - `journal_entry_lines`, `payment_voucher_lines`, `acc_receipt_lines`;
  - `ap_invoice_lines`, `acc_debtor_bill_lines`;
  - `staff_receipt_lines`, `payment_request_lines`.

  Saving a line writes both: `department` comes from the sub-department. A sub-department of another department is
  refused. Every report and filter that reads `department` today keeps working unchanged.
- The migration has no DROP. It is applied by hand to production before the code merges, in one transaction with its
  `pos_migrations` row.

### Screens

- **Ledger setup → Departments.** One list grouped by department. Each row has name, staff department, active and
  order. Add, rename, re-map, retire and reorder. Changing it needs the ledger post key (answer 12).
- **Document lines** (voucher, AP invoice, manual journal, receipt, payment request):
  - one Sub-department picker replaces today's For / department choice, grouped by department;
  - a renovation sub-department shows the project picker, filtered to that brand and optional;
  - Rental sub-departments show the unit picker, which comes first for Maintenance and Cleaning;
  - Company shows neither.
- **Reports**: P&L by department, the ledger's department filter, Rental Unit Costs (a sub-department column), and a
  "No unit" list for Maintenance and Cleaning.

### Rules in code

- The project limit is unchanged. It counts lines that name a project.
- A project's brand must match the line's renovation sub-department. If it does not, the line is refused with
  "SKYLINE is a The Conts project".
- A posted journal copies the line's `sub_department_id`, and a reversal copies it back.

## chew's answers (4 Nov 2026)

10. **Internal projects pick their brand.** A showroom-type internal project (`internal_department = supply`) can
    belong to either brand. It is chosen when the project is opened, stored as the project's `finance_kind`, and
    required for an internal Renovation project. An internal Rental project has no brand.
11. **Company stays one sub-department** for now. chew can add more later on the same list.
12. **The ledger post key maintains the list** (`scm.payment_voucher.post`), as for Ledger setup's other blocks.

## Not in this

- Splitting a Company cost between departments. That stays as today: Rental 50% / Supply chain 50% (SOP 3.2).
- Property OS screens. They send the staff department, and the engine picks the sub-department.
