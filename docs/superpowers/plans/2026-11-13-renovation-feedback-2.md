# Renovation feedback 2: renovation crew and their work

Status: plan, not built. Owner feedback, 13 Nov 2026 (slice 1 was PR 949).
Companion plan: `2026-11-13-do-scan-reject.md` (part C below).

## Problem

The Conts side runs its field work as Operations > Cleaning and Maintenance: an
office board of jobs by person, and a Jobs tab on the phone where the cleaner
or technician updates the job. Dream Crafter has renovation crew (Employee
Master > Renovation, role `renovator`) but nothing like it:

- The renovator's phone shows only Clock, Pay and Me
  (`RENOVATION_TABS` in `src/components/FieldShell.tsx`).
- Site tasks (`project_trade_tasks`) carry crew, planned dates, start, done,
  notes and progress photos, but every writer needs engine `projects.write`
  (`engine/backend/src/routes/renovation.ts` `/trade-tasks/:taskId/start`,
  `/complete`; `renovationBeta.ts` `/projects/:id/media`). Only the office can
  update them.
- No cross-project list of site tasks by person. The data is there
  (`GET /api/renovation/calendar` lists tasks with assignees and status), but
  only as a calendar.
- Dream Crafter > HR > Employees carries a "New" pill (`fresh: true`) that says
  nothing to the people using it.

Decision (13 Nov): the whole Dream Crafter > HR group goes (Employees page,
Employee Master, Performance, the empty Attendance and Punch sites tabs). In
its place a Dream Crafter OPERATIONS group with one item, Renovation, that
works like Cleaning and Maintenance. Renovation crew stay where they already
are: Conts HR > Employees > Employee Master, department Renovation (PR 949).

## Usage

Office (desktop), Dream Crafter sidebar:

```
OPERATIONS              (was: HR)
  Renovation            (was: Employees  [New])
```

Renovation page, tabs Board | History:

```
Board   [Renovator ▾] [Project ▾] [Status ▾] [This week ▾]   search
Late 3 · In progress 5 · Planned 12 · Unassigned 2

Task              Project              Crew           Planned      Status       Last update
Electrical 1st    Vortex A-12-03       Ali, Kumar     10-11 to 14-11  Late       12-11 photo
Tiling            Vortex A-12-03       Ali            15-11 to 20-11  Planned    —
Painting          Arte B-08-01         —              13-11 to 16-11  Unassigned —
```

Built (part A): tasks grouped under their project, like Defects. A row opens the
project's Site & photos tab, where crew, dates, Start and Mark done already live.
History = done and skipped tasks. Filter by person or contractor, and search.

Renovator (phone), bottom bar Jobs | Clock | Pay | Me:

```
Today · 2 tasks
┌───────────────────────────────┐
│ Electrical 1st fix   Late     │
│ Vortex A-12-03 · until 14-11  │
│ [ Start ]                     │
└───────────────────────────────┘
```

Task screen: what, where (building, unit, address), dates, crew, office note;
buttons Start, then Add photos and Mark done (note optional). Same look as the
cleaner's job screen.

## Shape

### A. Office board (engine page, no migration)

1. Engine route `GET /api/renovation/site-tasks` in `routes/renovation.ts`
   beside `/calendar`: same select, filters person, project, status, date
   range, plus `done` for History; paginated. Status from `tradeTaskStatus`,
   never recomputed in the page. Last update = newest `project_activity` media
   row per task.
2. Engine page `RenovationBetaSiteTasks.tsx` at `/beta/site-tasks`, built like
   `RenovationBetaDefectQueue` (cross-project queue, `PageGuard
   page="projects.list"`). Writes reuse the existing task endpoints (start,
   complete, assignees, dates). No new writer.
3. Property OS: `scmEngine.ts` maps `/supply/operations/renovation` to
   `/beta/site-tasks`. In `navigation.ts` the supply `HR` group becomes
   `{ label: 'OPERATIONS', workspace: 'supply', items: [{ key: 'dcRenovation',
   label: 'Renovation', icon: 'hammer', path: '/supply/operations/renovation',
   area: 'projects' }] }`, no `fresh`. `/supply/hr/employees` redirects there
   (`Moved`, like the old `/beta/*` links).

### A2. Remove Dream Crafter HR (same PR as A)

Deleted: `src/pages/workers/DcEmployeesTab.tsx`,
`DcEmployeePerformanceTab.tsx`, `DcHrEmptyTab.tsx`, the `dreamCrafter` prop
and its branches in `EmployeesPage.tsx`, `functions/api/employees/dream-crafter.ts`,
the `DcEmployee` types in `functions/_lib/hrFields.ts`, the `dcHr` area and
its API rule in `functions/_lib/access.ts`, its rows in
`scripts/api-checks/rbac-matrix.expected.json`.

Kept: the `dc_staff` table and `employees.dc_staff_id` (migration 0185). No
drop in this change. Before merge, count rows on production read-only:

```sql
select count(*) from dc_staff;
select count(*) from employees where dc_staff_id is not null;
```

Zero: a later migration can drop them. Not zero: those people need a home
first (Conts Employee Master, or nowhere), owner's call.

### B. Renovator phone Jobs (no migration)

4. Engine: a `site-forward` router beside `claims-forward`, behind the same
   staff assertion (`conts/staff-identity.ts`). The assertion names the
   Property OS user; the engine finds their `project_people` row by
   `pos_user_id`. Every route limits to tasks where that person is an
   assignee (`project_trade_task_assignees`):
   - `GET /mine?range=today|week|done`
   - `POST /:taskId/start`, `POST /:taskId/complete { note }`,
     `POST /:taskId/photos` (files, then the media row with target
     `task:<id>`).
   The start and complete rules move out of the two route handlers into
   `services/renovation/tradeTasks.ts` (`startTask`, `completeTask`), so the
   office route and the crew route call one rule. PO-linked tasks stay
   "completes on receipt" for both.
5. `staff-identity.ts`: add `renovator` to the roles that resolve, without
   adding it to `FIELD_ROLES` (that flag narrows claims to cleaning and
   maintenance jobs; renovator claims rules are separate work).
6. Property OS: `functions/_lib/siteForward.ts` (same shape as
   `claimsForward.ts`), `functions/api/field/site-tasks/[[path]].ts` with a
   path allow list, renovator only. `FieldShell` gives renovators
   Jobs | Clock | Pay | Me; Jobs reuses the cleaner job card and job screen
   components with a site-task adapter.

### C. DO scan reject

See `2026-11-13-do-scan-reject.md`. Independent of A and B.

## Synthesis decision

Base: the engine owns site tasks, so the board is an engine page and the phone
reaches the engine through the existing forward bridge.

- Rejected: copy site tasks into Property OS and build the board there like
  `CleaningPage`. Two homes for one task, a sync to keep honest.
- Rejected: give renovators engine accounts. They are field staff on the
  portal; claims already solved "phone worker with no engine account".
- Rejected: separate "my task" writers for the crew. Moving start and
  complete into `tradeTasks.ts` keeps one rule for office and crew.

## Tradeoffs accepted

- We accept the board living in the engine frame, in exchange for no copy of
  the data.
- We accept that a renovator sees only tasks they are assigned to. Unassigned
  tasks are the office's to hand out.
- We accept no "reopen" for the crew. Undoing a done task stays an office job.

## Files

| | File | Change |
|---|---|---|
| ✏️ | `engine/backend/src/routes/renovation.ts` | `GET /site-tasks`; start and complete call the service |
| ✏️ | `engine/backend/src/services/renovation/tradeTasks.ts` | `startTask`, `completeTask` |
| 🆕 | `engine/backend/src/conts/site-forward-routes.ts` | crew routes behind the staff assertion |
| ✏️ | `engine/backend/src/conts/staff-identity.ts` | renovator resolves |
| 🆕 | `engine/frontend/src/pages/renovation-beta/RenovationBetaSiteTasks.tsx` | board, history |
| ✏️ | `engine/frontend/src/App.tsx` | `/beta/site-tasks` |
| ✏️ | `src/lib/navigation.ts` | supply HR group out, OPERATIONS > Renovation in |
| ✏️ | `src/lib/scmEngine.ts` | `/supply/operations/renovation` mapping |
| ✏️ | `src/App.tsx` | route, redirect from `/supply/hr/employees` |
| ✏️ | `src/pages/EmployeesPage.tsx` | `dreamCrafter` prop and branches gone |
| 🗑️ | `src/pages/workers/DcEmployeesTab.tsx`, `DcEmployeePerformanceTab.tsx`, `DcHrEmptyTab.tsx` | Dream Crafter HR |
| 🗑️ | `functions/api/employees/dream-crafter.ts` | its API |
| ✏️ | `functions/_lib/hrFields.ts`, `functions/_lib/access.ts`, `scripts/api-checks/rbac-matrix.expected.json` | `DcEmployee` types, `dcHr` area |
| 🆕 | `functions/_lib/siteForward.ts`, `functions/api/field/site-tasks/[[path]].ts` | forward |
| ✏️ | `src/components/FieldShell.tsx` | Jobs tab for renovators |
| 🆕 | `src/pages/portal/SiteTasks*.tsx` | phone list and task screen |
| tests | engine `tests/`, `functions` tests, portal tests | crew sees only own tasks; PO task refuses; other company refused |

## Phone layout

- Office board on a phone: card list (task, project, crew, status pill), filters
  in a sheet, side panel becomes a full screen. Summary counts as one scrolling
  chip row.
- Renovator Jobs: one column of cards, Today first then This week. Task screen:
  primary button pinned at the bottom in thumb reach (Start, then Mark done),
  Add photos above it. 44px targets, 16px note box.
- Test at 360px and 390px on staging, and desktop.

## Rollback

No migration in A or B. Revert the PRs: Dream Crafter HR comes back as it was,
its table never left. Anyone's saved `dcHr` permission level is lost with the
area; note the people who had it before merge.

## Open questions

1. Who opens the board: everyone with Projects access (plan), or a new
   "Renovation board" permission?
2. Can a renovator add a task or only update theirs? (Plan: update only.)
3. Pay per task like Cleaning's Pay tab? Not in this plan.
4. Not checked: renovators show in the crew picker on staging; `dc_staff` row
   count on production.

## Next implementation step

Move start and complete into `tradeTasks.ts` with tests, then
`GET /api/renovation/site-tasks`.
