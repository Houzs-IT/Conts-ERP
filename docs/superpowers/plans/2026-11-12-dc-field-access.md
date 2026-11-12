# Dream Crafter staff: app login, PIN and clock-in

Branch: `feat/dc-field-access`, stacked on `feat/dc-employee-master` (PR #915). Merge #915 first.

## Goal

Dream Crafter's own staff (the `dc_staff` roster, Department "Renovation") get what The Conts' cleaners and technicians
have for the phone:

1. **Give app access / Reset PIN / Switch off** on Dream Crafter > HR > Employees > Employee Master.
2. **Sign-in at `/portal`** with Employee ID (EMP-0xx, the same number series) and a 6-digit PIN, choosing their own
   PIN the first time.
3. **Clock in / out** on the phone with a selfie and location, the same Clock screen The Conts uses.
4. **Attendance tab** on Dream Crafter > HR > Employees: each day's punches, selfies, forgotten clock-outs, and keying
   a day for someone who forgot. It replaces the empty page there today.

Next PR, outlined at the end: Punch Sites (showroom, warehouse) and Working Hours.

The phone app for a Dream Crafter worker has **Clock** and **Me (account)** only. There are no Jobs, Receipts, Pay or
Leave, because Dream Crafter has no renovation job list for a person, no payroll and no leave yet. Their home is
`/portal/clock`.

## Decisions (defaults; change before building)

| # | Question | Default |
|---|---|---|
| D1 | New login role name | `renovator`, shown as "Renovation" in the phone header |
| D2 | Which department their login sits in | A new department, **Renovation crew**: kind `renovation`, side `dream_crafter`. The existing "Renovation" department is kind `staff` (desk logins), so making it a field kind would turn desk people into phone-only accounts. |
| D3 | Who may give app access, reset a PIN and switch someone off | Give app access and Reset PIN: Full on `dcHr` (Dream Crafter > HR > Employees), plus management. The Conts uses Full on Operations, which is closed on the Dream Crafter side. Switch off / on: Edit on `dcHr`, as The Conts' Switch off needs Edit on its department. |

## Where it lives

Everything follows The Conts' field login. It is extended in place, not copied:

- Role and kind lists: `functions/_lib/auth.ts` (`FIELD`), `functions/_lib/fieldPin.ts` (`PIN_ROLES`),
  `functions/_lib/access.ts` (`DepartmentKind`, `kindOf`, `roleForKind`, `isFieldKind`), `src/lib/types.ts`,
  `src/lib/navigation.ts`, `src/lib/vocabulary.ts`.
- The login is made by `giveFieldAccess` (`functions/_lib/fieldAccess.ts`), which gains a third list, `dc_staff`.
- Clock-in is keyed on `employees.id` already (`functions/_lib/attendance.ts`). Only "which employee is this login"
  (`employeeForUser`) needs to learn about `dc_staff`.
- Dream Crafter office screens get their own routes under `/api/.../dream-crafter`, as `/api/employees/dream-crafter`
  does, because the HR area is closed to the Dream Crafter side.

## Step 1: database (migration `0311_dc_field_access.sql`)

```sql
set local search_path = pos;
ALTER TABLE dc_staff ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE REFERENCES users(id);
ALTER TABLE dc_staff ADD COLUMN IF NOT EXISTS is_active SMALLINT NOT NULL DEFAULT 1;
-- users.role CHECK (0001) and departments.kind CHECK (0145) gain 'renovator' / 'renovation':
--   drop and re-add each by finding it with pg_get_constraintdef, as 0185 does, and RAISE if not found.
INSERT INTO departments (id, name, kind, side, sort, ...) VALUES (..., 'Renovation crew', 'renovation', 'dream_crafter', ...)
  ON CONFLICT DO NOTHING;
-- REVERSAL (only once no renovator login exists):
--   DELETE FROM departments WHERE kind = 'renovation';
--   re-add both CHECKs without the new values;
--   ALTER TABLE dc_staff DROP COLUMN is_active, DROP COLUMN user_id;
```

The code reads `dc_staff.user_id` only when it exists (`hasColumn`), so the Employee Master keeps working before 0311
runs. The access buttons just don't show.

## Step 2: the role, everywhere the field roles are listed

- `auth.ts` `FIELD`, `fieldPin.ts` `PIN_ROLES`, and the hardcoded list in `functions/api/auth/login-pin.ts:28` (make it
  use `PIN_ROLES`).
- `access.ts`: `DepartmentKind` + `'renovation'`, `roleForKind`, `isKind`, `isFieldKind`, `kindOf` (renovator →
  renovation). `door.ts` `homeFor`: kind renovation → `/portal/clock`.
- `view-as.ts` `KIND_OF_ROLE`, `twoStepLegacy.ts`, `roles.ts` `ROLES`.
- Engine `engine/backend/src/conts/staff-identity.ts` `FIELD_ROLES`: add `renovator`, so receipts never treat them as
  office staff, even though their phone app has no Receipts tab.
- Frontend: `types.ts` `UserRole` and `DepartmentKind`; `navigation.ts` `DENY`, `FIXED_ROLES`, `HOME`;
  `vocabulary.ts` `ROLE_LABEL` ("Renovation"); `areaAccess.ts`; `NotificationBell.tsx:111`;
  `components/permissions/shared.ts` `isFieldKind`; the `FIELD_ROLES` pickers in `CleaningPage.tsx`,
  `MaintenancePage.tsx` and `OpsUi.tsx` stay cleaners and technicians only (no change, but check they don't list renovators).
- `App.tsx:262-265`: the field branch includes `renovator`.

## Step 3: what a renovator may call (`functions/api/_middleware.ts`)

`FIELD_ALLOWED` stays as is for cleaners and technicians. A renovator gets a narrower list: session, logout,
change-password, account, notifications, `GET/POST /api/field/clock`. Everything else answers "This is not available in
the field app." The exact-role handlers (`field/tasks`, `field/repairs`, picks, `documents/[id]/download`,
`maintenance/issues`) are then never reached by a renovator.

## Step 4: giving access (`functions/_lib/fieldAccess.ts`)

- `LISTS` gains `dc_staff: { role: 'renovator', noun: 'employee', action: 'hr.dc_staff', kind: 'renovation' }`.
  `dc_staff` has no `employment_type`, so that check applies to cleaners and technicians only.
- Permission per list: cleaners and technicians keep Full on Operations. `dc_staff` needs Full on `dcHr`.
- `followWorker`: a renovator login follows its `dc_staff.is_active`.
- New route `POST /api/employees/dream-crafter/:id/access` (area `dcHr` in the `access.ts` route rules) calls
  `giveFieldAccess(env, session, 'dc_staff', id)`.
- Switch off / on: `PUT /api/employees/dream-crafter` takes `isActive`, saves `dc_staff.is_active`, and calls
  `followWorker` (login stops at once, sessions end). Switched-off staff come off the Attendance list unless they punched.

## Step 5: clock-in (`functions/_lib/hr.ts`, `functions/api/field/clock.ts`)

- `hr.ts`: `clockPersonFor(env, userId): Promise<{ recordId: string; name: string; employeeId: string | null;
  status: EmployeeStatus } | null>`. Conts first (as `employeeForUser` + `ensureEmployeeId` do today), then
  `dc_staff.user_id → employees.dc_staff_id` (a Dream Crafter record always has its `employees` row).
- `clock.ts` GET and POST use `clockPersonFor`. `NOT_ON_LIST` says "the company's own staff", not "cleaners and
  technicians".
- `attendance.ts` (`clockIn`, `clockOut`, selfie to R2, forgotten clock-outs) is unchanged.
- **Punch sites:** a Dream Crafter punch is compared with no site in this PR, so it reads as "location kept", never "At
  <site>". It is never refused, as for The Conts. The next PR adds Dream Crafter sites.

## Step 6: the phone app (`src/components/FieldShell.tsx`, `src/pages/LoginPage.tsx`)

- `FieldShell` bottom tabs for a renovator: **Clock** and **Me**. Cleaners and technicians keep their five.
- Home `/portal/clock`. `FieldHome` is never shown to a renovator.
- `LoginPage.tsx:22` copy: "Cleaners, technicians and site staff" (or "The company's own staff").
- The Clock screen (`FieldClockPage.tsx`) is unchanged. Check its wording doesn't name cleaning jobs.

## Step 7: the office Attendance tab for Dream Crafter

- API `GET /api/attendance/dream-crafter?date=` (area `dcHr`): every Dream Crafter employee who punched that day, or is
  active and switched on, with the day's punch. This has the same shape as `/api/attendance`, keyed by `dcStaffId`.
- `POST /api/attendance/dream-crafter` (management fallback, `dcHr` edit): key or fix a day for someone, using the same
  `attendance.ts` helpers and rules as `functions/api/attendance/index.ts`.
- `GET /api/attendance/dream-crafter/:id/photo/:side`: the selfie, only for a Dream Crafter row.
- Frontend: `src/pages/workers/DcAttendanceTab.tsx` 🆕, built from `AttendanceTab.tsx`'s pieces. If the row, punch
  and selfie viewer parts are inside AttendanceTab, move them out to a shared file first (as `EmployeePaySections` was),
  so this is not a copy. `EmployeesPage.tsx` renders it for `dreamCrafter && tab === 'attendance'`. The Present /
  Working Hours tiles read it instead of "—".
- `DcHrEmptyTab` keeps only `punch-sites`.

## Step 8: Employee Master buttons (`src/pages/workers/DcEmployeesTab.tsx`)

- Row actions, as The Conts': **Give app access** / **Reset PIN** (Full on `dcHr`), **Edit**, **Switch off / on**.
  `AccessModal` is reused with `rosterApi: '/employees/dream-crafter'`. The copied message names Dream Crafter.
- An Emp No column and a read-only Employee No field in the form, as The Conts'.
- Status "Switched off" (warning tone) when `isActive` is false, as The Conts'.
- Phone: actions sit on the card, as The Conts' `renderCard` does.

## Phone layout

- Field app: the existing phone-first `FieldShell`, with two bottom tabs within thumb reach. The Clock screen is unchanged.
- Employee Master: a card list with its action buttons (44px), as The Conts'.
- Attendance tab: a card per person below `sm`, as The Conts' Attendance tab. The selfie opens full screen.

## Files

| | File |
|---|---|
| 🆕 | `migrations-pg/0311_dc_field_access.sql` |
| ✏️ | `functions/_lib/auth.ts`, `fieldPin.ts`, `access.ts`, `door.ts`, `roles.ts`, `twoStepLegacy.ts`, `fieldAccess.ts`, `hr.ts` |
| ✏️ | `functions/api/_middleware.ts`, `auth/login-pin.ts`, `auth/view-as.ts`, `field/clock.ts`, `employees/dream-crafter.ts` |
| 🆕 | `functions/api/employees/dream-crafter/[id]/access.ts` (check how Pages routes `dream-crafter.ts` beside a `dream-crafter/` folder; move the file to `dream-crafter/index.ts` if needed) |
| 🆕 | `functions/api/attendance/dream-crafter.ts`, `.../dream-crafter/[id]/photo/[side].ts` |
| ✏️ | `engine/backend/src/conts/staff-identity.ts` |
| ✏️ | `src/lib/types.ts`, `navigation.ts`, `vocabulary.ts`, `areaAccess.ts`, `src/App.tsx`, `components/FieldShell.tsx`, `components/NotificationBell.tsx`, `components/permissions/shared.ts`, `pages/LoginPage.tsx` |
| ✏️ | `src/pages/EmployeesPage.tsx`, `workers/DcEmployeesTab.tsx`, `workers/DcHrEmptyTab.tsx`, `workers/AttendanceTab.tsx` (shared parts out) |
| 🆕 | `src/pages/workers/DcAttendanceTab.tsx` (+ a shared attendance parts file if needed) |
| ✏️ | `scripts/api-checks/field-pin-sign-in.mjs`, `rbac-matrix.mjs` / `.expected.json`, `role-access.mjs`, `view-as.mjs`, `mobile-field.mjs`: add renovator cases |

## Checks

1. `npm run typecheck`, `npm test`, and `npm run check`.
2. API checks (staging): a renovator signs in with a PIN and must change it; clock in and out with a selfie; every
   route outside the narrow list answers 403 (try `/api/field/tasks`, `/api/claims`, `/api/field/pay`); Switch off
   ends the session and blocks sign-in; a cleaner and a technician behave exactly as before.
3. Office on staging: a Dream Crafter-only person with Full on `dcHr` can give access and sees Attendance. The same
   person without it sees no buttons and gets 403. A Conts-only person can't reach any Dream Crafter route.
4. Phone at 360px and 390px: PIN sign-in, first-PIN change, Clock with the camera, Employee Master cards, Attendance cards.
5. The Conts' Attendance, Working Hours and Payroll still show no Dream Crafter person.

## Rollback

Revert the PR, then run 0311's REVERSAL lines in their written order: drop the `dc_staff` columns, turn renovator
logins into switched-off technician rows outside any department, remove the Renovation crew positions and department,
then re-add both CHECKs. Their punches stay in `attendance` on their `employees` rows.

## Next PR (outline only)

- **Punch Sites for Dream Crafter:** a `dc_punch_sites` table (name, lat, lng, radius, default 200 m) and a Punch Sites
  tab. `attendance.ts` `punchSites` takes the person's company, so a Dream Crafter punch reads "At Showroom".
- **Remove clock-out for Dream Crafter:** the office's undo for a clock-out pressed by mistake, through a Dream Crafter
  route (The Conts' `DELETE /api/attendance/:id` refuses Dream Crafter rows).
- **Working Hours for Dream Crafter:** built from the punches. `working_hour_entries.department` CHECK gains `renovation`.
