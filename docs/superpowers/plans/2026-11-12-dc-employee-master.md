# Dream Crafter Employee Master, built like The Conts'

Branch: `feat/dc-employee-master` (from `origin/main` at 9fe235c4).

## Goal

Dream Crafter > HR > Employees > Employee Master (`/supply/hr/employees?tab=employee-master`) works like The Conts'
Employee Master (`/hr/employees?tab=employee-master`): the same columns, a phone card list, and the same employee form
with Details, Pay, How they are paid, Statutory and PCB tax declaration. The department is **Renovation**, and the
position is **Leader / Employee**, in that order, as on The Conts' (owner, 12 Nov 2026).

Not the same, on purpose:

| The Conts has | Dream Crafter gets | Why |
|---|---|---|
| Emp No, Give app access, Reset PIN | Nothing | Dream Crafter staff have no login (migration 0185). |
| Switch off / Switch on | Nothing | `dc_staff` has no `is_active`. Leaving is Status = Resigned. |
| Department picker (Cleaning / Maintenance) | A read-only "Renovation" line and column | One department, so there is nothing to pick. |
| Department filter (All / Cleaning / Maintenance) | No filter | With one department, All and Renovation are the same list. |
| Status option "Test account" | Active, Resigned only | Test accounts are logins; Dream Crafter has none. |

Dream Crafter's Job title field goes away. Pay, bank and statutory details are saved on the HR record. Nothing pays
Dream Crafter staff yet (no Dream Crafter payroll), and The Conts' Payroll never lists them, because it is built from
cleaners and technicians.

## Where it lives

Both companies already share one HR table, `employees`. Every pay, bank and statutory column is on it, and a Dream
Crafter row (`dc_staff_id` set) can hold them today. The record's rules (`employeeInput` in `functions/_lib/hrFields.ts`)
and the form's pay sections (in `src/pages/workers/EmployeesTab.tsx`) are the natural home. The work moves them out
where both forms and both APIs can share them, instead of copying about 150 lines of form and 40 of API code.

## Step 1: refactor, no behavior change

**1a. `functions/_lib/hrFields.ts`**
- Split `employeeInput` into a plain object, `employeeRecord` (no refine), and `employeeInput = employeeRecord.refine(...)`
  (the refine stays the same). `employeeRecord` is what Dream Crafter extends in step 2.

**1b. `functions/_lib/hr.ts`**
- `toEmployeeRecord(row): EmployeeInput`: the HR-record half of `toEmployee` (position through medical leave, with
  the same defaults). `toEmployee` spreads it.
- `employeeRecordColumns(input: EmployeeInput): [string, unknown][]`: the `cols` list from
  `functions/api/employees/index.ts`, moved as is (including "cash keeps no bank").
- `recordSalaryChange(env, { employeeId, before, after, askedFrom, userId })`: the `employee_salary_history` insert from
  the same file, moved as is (including the `hasPayroll` check).
- `employeeForAudit(record)`: `forAudit` plus `PRIVATE`, moved as is (the bank account becomes "set" or "not set").
- `functions/api/employees/index.ts` calls these four. Its behavior must not change.

**1c. `src/pages/workers/EmployeePaySections.tsx`** 🆕
- Moved from `EmployeeForm`: `Section`, `STATUTORY`, and the Pay, How they are paid, Statutory and PCB sections,
  including the "New salary takes effect from" date.
- Props: `{ record, onChange, errors, salaryChanged, salaryFrom, onSalaryFromChange }`, the same state the form
  holds now.
- `EmployeesTab.tsx`'s `EmployeeForm` renders `<EmployeePaySections …/>` where the four sections are now.

Proof for step 1: `npm run typecheck`. The Conts' form looks the same and saves the same: open it on staging, change
the salary, check that the salary-history row and the audit entry match what they were before.

## Step 2: build Dream Crafter on it

**2a. Position replaces Job title.** Dream Crafter uses The Conts' Leader tick, saved in `employees.position` as
`employee` / `leader`. No migration: the old free text already in `position` reads as Leader when it says "leader" and
as Employee otherwise (the same rule `toEmployee` uses), and the next save writes `employee` or `leader` in its place.

**2b. `functions/_lib/hrFields.ts`**
- `DC_DEPARTMENT_LABEL = 'Renovation'`.
- `dcEmployeeInput = employeeRecord.extend({ name, phone, status: z.enum(['active', 'resigned']) }).refine(<same resigned rule>)`.
- `DcEmployee = DcEmployeeInput & { id: string }`, where `id` is the `dc_staff` id. `jobTitle` is gone:
  `DcEmployeePerformanceTab` shows a Position column (Employee / Leader) in its place. `EmployeesPage` reads only
  `status` and needs no change.

**2c. `functions/api/employees/dream-crafter.ts`**
- GET: `SELECT d.id, d.full_name, d.phone, e.* FROM dc_staff d JOIN employees e ON e.dc_staff_id = d.id`, mapped
  with `toEmployeeRecord` plus name, phone and id. Order unchanged (active first, then by name).
- PUT: validate with `dcEmployeeInput`. Keep the single CTE statement (roster row and HR row together), and write
  every column from `employeeRecordColumns`. Then `recordSalaryChange`. The audit uses `employeeForAudit`, so the bank
  account never goes in the trail. The action names stay `hr.dc_employee_create` / `hr.dc_employee_update`.
- Access unchanged: area `dcHr` (route rule in `functions/_lib/access.ts`), management-only fallback.

**2d. `src/pages/workers/DcEmployeesTab.tsx`**
- Columns: Name, Department ("Renovation"), Position (Employee / Leader), Basic Salary (or "RM x / day"), Status.
  These are The Conts' columns, minus Emp No and the action buttons.
- `renderCard` for phone, as The Conts has: name and status badge, then "Renovation · Position", then pay.
- The header subtitle says "Open a person for their pay, bank and statutory details."
- Form (`width={640}`, as The Conts'): a **Details** section in The Conts' order (Name, Phone, Leader tick, Department
  "Renovation" read-only, Status, Join date, Last working day, Nationality), then `<EmployeePaySections/>`.
- A note under Pay: "Saved for Dream Crafter payroll, which is not set up yet."

## Phone layout

- **List:** the table becomes a card list below `sm`, through `DataTable`'s `renderCard`, the same as The Conts'.
  Tapping a card opens the form. The cards have no row buttons, so touch targets are the whole card.
- **Form:** the existing `Modal`, a single column below `sm` (`grid-cols-1 sm:grid-cols-2`), with the body scrolling.
  Money and number fields use the house `MoneyInput` / `NumberInput`, and Phone uses `PhoneInput`.
- **Stat tiles:** already hidden on phone for Employee Master (`EmployeesPage`). No change.

## Files

| | File |
|---|---|
| ✏️ | `functions/_lib/hrFields.ts` |
| ✏️ | `functions/_lib/hr.ts` |
| ✏️ | `functions/api/employees/index.ts` (calls the moved helpers only) |
| ✏️ | `functions/api/employees/dream-crafter.ts` |
| 🆕 | `src/pages/workers/EmployeePaySections.tsx` |
| ✏️ | `src/pages/workers/EmployeesTab.tsx` (uses `EmployeePaySections`) |
| ✏️ | `src/pages/workers/DcEmployeesTab.tsx` |
| ✏️ | `src/pages/workers/DcEmployeePerformanceTab.tsx` (Job title column becomes Position) |

## Checks

1. `npm run typecheck` and `npm test`.
2. Staging, The Conts: edit one employee's salary, bank and PCB. The saved values, salary history and audit entry
   are the same as before the refactor.
3. Staging, Dream Crafter: add a person with pay, bank and EPF. Reload: everything is still there. Set Resigned with no
   last day: the form refuses. Switch to cash: the bank is cleared. The audit shows the bank account as "set".
4. Someone without `dcHr` edit: no Add button, rows do not open the form, and a PUT gets 403.
5. 360px, 390px and desktop: the card list, the form scrolling with the keyboard open, no sideways scroll.
6. The Conts' Payroll and Employees lists still show no Dream Crafter person.

## Rollback

Revert the PR. No migration. A job title overwritten by a save is gone from `employees`; the audit trail keeps the old
value. Pay values saved on Dream Crafter rows stay on the `employees` rows and are harmless: nothing reads them for
Dream Crafter.

## Decided

- Job title is dropped. Department (Renovation) comes first, then Position: Leader / Employee (owner, 12 Nov 2026).
- Annual and medical leave days stay off the form, as on The Conts'.
