# Beta: renovation project workspace (owner, 23 Oct 2026)

Status: draft, waiting for the owner's OK.

Source: the "Renovation Project Workspace" mockup (project RN-2608-002, Legacy OUG A26-03), reviewed in chat on
23 Oct 2026. The owner asked for all three bundles (A, B, C), on staging only, under a new menu group called Beta.

## 1. Decisions

| # | Decision |
|---|---|
| 1 | Beta is a new sidebar group. Its first entry is "Project workspace": a list of renovation projects that opens the mockup's workspace for one project. The existing project pages stay as they are. |
| 2 | Staging only, through a switch: `BETA_ENABLED = "true"` in `engine/backend/wrangler.toml` (staging). `wrangler.production.toml` does not set it. Code merges to `main` as normal, so `staging` stays level with `main`. |
| 3 | With the switch off: every `/api/beta/*` and `/api/public/beta-client/*` route answers 404 before it reads anything, `/api/auth/me` reports `beta_enabled: false`, and the sidebar and the `/beta/*` screens do not show. |
| 4 | Beta never changes how an existing screen or rule behaves. It reads existing tables and writes only to its own tables or to new columns that existing code ignores. `gate.ts` is untouched: "carpentry waits for the 3rd payment" is a warning in Beta, not a block. |
| 5 | No scheduled jobs (engine rule). "Remind client / plumber" opens WhatsApp with a ready message (`wa.me` link) and logs the reminder on the timeline. "N days late" is worked out when the page is read. |
| 6 | Quantities are never read from a drawing PDF. Staff type the area (sqft) or length once; Beta works out boards, tees and paint litres from rules kept in Beta settings. |
| 7 | All Beta code lives in files named `renovationBeta*` / `renovation-beta*` (engine rule: renovation code in `renovation*` files). |

## 2. Switch and wiring

- Backend: `backend/src/scm/lib/renovation-beta-enabled.ts`: `isBetaEnabled(env): boolean` (only `"true"` counts), the same shape as `costing-enabled.ts`.
- Backend: `backend/src/routes/renovationBeta.ts` (Hono router, mounted at `/api/beta`, behind the normal auth gate). First middleware: `if (!isBetaEnabled(c.env)) return c.json({ error: "not_found" }, 404)`.
- Backend: `backend/src/routes/renovationBetaPublic.ts`, mounted at `/api/public/beta-client` BEFORE the auth gate (same place as `publicContractorCalendar`), with the same 404 switch first.
- `routes/auth.ts` `/me`: add `beta_enabled: isBetaEnabled(c.env)` to the user payload.
- Frontend: `components/Sidebar.tsx` gains a "Beta" group shown only when `beta_enabled` and the user has `projects` page access. Routes `/beta/projects` and `/beta/projects/:id` in `App.tsx`, lazy-loaded from `pages/renovation-beta/`.
- Permissions: reads need page access `projects.list`; writes need `projects.write`. These are the same checks as the existing project routes.

## 3. Database (migrations-pg, additive only)

The migration files land in `main`, so the next run of the production migration workflow will also create these
tables in production. They stay empty and unused there, because every route that touches them is switched off.

### 0144_beta_workspace_a.sql (bundle A)
- `public.project_defects` gains: `trade text` (carpenter, electrician, plumber, painter, plaster, hacking, other),
  `fixed_at timestamptz`, `fixed_by bigint`, `after_photo_r2_key text`, `redo_count int not null default 0`.
  Beta states: open (`fixed_at` null, `closed_at` null) → check it (`fixed_at` set) → done (`closed_at` set).
  "Redo" clears `fixed_at` and adds 1 to `redo_count`. The existing snag close route keeps working unchanged.
- `public.project_design_file_approvals`: id, project_id, file_id (→ project_design_files), approved_on date,
  recorded_by bigint, approved_by_name text, note, created_at. The "approved set" of a kind is the newest file with
  an approval row. "Waiting client" means a newer file of that kind with no approval row.
- `public.project_design_sent`: id, project_id, file_id, sent_on date, due_on date, sent_by. This is the date a
  revision was sent to the client and the date the client should answer by.
- `public.project_beta_settings`: company_id pk, `design_3d_days int default 10`, `design_2d_days int default 12`.
- `public.project_beta_reminders`: id, project_id, kind (client_approval, client_answer, defect, payment),
  ref_id text, sent_by, sent_at. Written when a WhatsApp reminder button is pressed, so it shows on the timeline.

### 0145_beta_workspace_b.sql (bundle B)
- `scm.reno_beta_line_specs`: so_item_id uuid pk (→ scm.mfg_sales_order_items), company_id, colour_code,
  colour_temp, area_sqft numeric(12,3), qty_override numeric(12,3), note, updated_by, updated_at.
  These are the yellow fields on the PO tab, keyed to the SO line so they survive document edits.
- `scm.reno_beta_qty_rules`: id, company_id, item_code (the catalog line it applies to), output_label,
  per_unit numeric (sqft or ft per output unit), spare_pct numeric default 0, pack_sizes numeric[] (for paint: 18, 5),
  coats int default 1, active. Output = ceil(measure × coats / per_unit × (1 + spare_pct/100)). Paint packs are
  split largest first. Seeded with 3 starter rules that the owner can edit: gypsum board 24 sqft, ceiling tee,
  paint coverage.
- "Client buys this" already exists on contract lines (`scm.reno_doc_lines.supply_by_owner`). It needs no new column.
- `scm.reno_beta_client_items`: so_item_id pk (→ scm.mfg_sales_order_items; SO rows are stable, doc lines are
  re-inserted on every save), project_id, `needed_on_site_by date`, `ask text`
  ("Model and cut-out size, before the quartz top is cut"). Staff fill these in.

### 0146_beta_workspace_c.sql (bundle C)
- `public.project_beta_client_links`: id, project_id, token_hash text unique (sha-256 of the token; the token itself
  is never stored), created_by, created_at, sent_at, first_opened_at, last_opened_at, revoked_at, expires_at
  (default 120 days).
- `public.project_beta_client_answers`: id, project_id, item_key text (client item id), model text, size text,
  status (bought, not_yet, later), note, answered_at, from_link_id. Unique on (project_id, item_key).
- `public.project_beta_client_answer_photos`: id, answer_id, r2_key, content_type, size_bytes, uploaded_at.
- `public.project_beta_light_ticks`: project_id, light_key text, bought boolean, ticked_at. Primary key (project_id, light_key).
- `public.project_design_sheets`: id, project_id, kind, sheet_no, title, file_id, page_no, from_version,
  superseded_by (see "Replace changed pages" in section 5).

Each migration has a `-- REVERSAL:` first line that drops exactly what it adds, like the existing ones.

## 4. Screens: the workspace tabs

| Tab | Reads (existing) | Beta adds |
|---|---|---|
| Header + payments strip | project, people, billing view (`renovation-billing.ts` instalments, received) | Each instalment shows the step it unlocks (`stage_code` / `trigger`) and whether it is paid. |
| To do card | design files, billing, defects, client items | Computed list: revision waiting for client approval, next payment needed before a site task, client answers due within 7 days, late defects. Each row has one action button. |
| Overview | SO, scope, rooms, team, site tasks progress, key log | Layout only. Key pass uses the existing key-moves route. |
| Drawings | design files, versions, notes, 3D links | Approved set vs waiting revision, "Send to client" (sent + due dates), "Record approval", history, and "Replace changed pages" (C, see below). |
| VO | variation orders, lines | Each VO line shows where it goes: PO (bought by us) or Client PO (`supply_by_owner`). |
| PO | SO lines not supplied by the owner, PO split preview | Yellow fields (`reno_beta_line_specs`) and auto quantities from `reno_beta_qty_rules`. "Create PO" calls the existing split. Export as CSV. |
| Client PO | SO lines with `supply_by_owner` | "Needed on site by" and "What we need" per line, client answers, a lights and fans list per room (LIGHTING catalog group, by `room`), and a client PDF (jsPDF, as for existing prints). |
| Site & photos | GRN site photos, onsite entry files, defect photos | One feed, newest first, filterable by room where the room is known. |
| Defects | project_defects | Three columns (To fix / Check it / Done), who fixes it, fix-by date, before and after photo, Redo / OK close, WhatsApp reminder, and "N of M closed" for handover. |
| Timeline | existing timeline | Search box, RECORD tag on approvals, payments and keys, and CSV export. Beta reminders and approvals appear as entries. |
| Calendar | existing calendar + step SLA | 3D deadline = site measure date + `design_3d_days`; 2D deadline = 3D approval + `design_2d_days`. |

## 5. Bundle C detail

### Client link
- Staff press "Create client link". The server makes 32 random bytes (`crypto.getRandomValues`, base64url), stores only
  the sha-256 hash, and returns the token once. The screen builds the link as `${window.location.origin}/c/<token>`
  (the engine screens site), as the service case portal link does (`ServiceCases.tsx`). It does not use `PUBLIC_APP_URL`,
  which points at the rental app. Copy and WhatsApp buttons follow. "Revoke link" sets `revoked_at`.
- Public routes (`/api/public/beta-client/:token`): GET the page data, POST an answer, POST a photo (raw body, 8 MB
  limit, jpg / png / webp / pdf only, stored under `renovation/<projectId>/client/`), and POST light ticks.
- The project is read off the token row, never from the request. Every write re-checks that the item belongs to that
  project. Revoked or expired tokens answer 404. `checkRateLimit(clientIp)` on every route, as in `publicContractorCalendar`.
  Each link may store at most 20 photos (counted in `project_beta_client_answer_photos`), so a leaked link cannot fill storage.
- Minimum data shown: company name, client first name, unit name, the client-buy items with their asks and due dates,
  the lights list, and the client's own answers. No prices, phone numbers, staff names except the designer's first
  name, or other documents.
- Frontend: a public page `pages/renovation-beta/ClientLinkPage.tsx`, routed outside the login wall like
  `PublicDoScan.tsx`.

### Replace changed pages
- Upload only the changed pages (one PDF) and tick which sheets they replace from the current set's sheet list.
- `public.project_design_sheets` (in 0146): id, project_id, kind, sheet_no, title, file_id, page_no, from_version, superseded_by.
- The server (pdf-lib, already in the backend) builds the combined "site set" PDF on demand from the sheet list and
  stores it as a new design file version marked `assembled`.
- Compare: two pages side by side in the browser (pdfjs-dist, already in the frontend), old sheet on the left and
  new on the right. No automatic difference highlighting.

## 6. Order of work, files, checks

1. Switch + Beta group + empty workspace shell with tabs. Check: staging shows Beta; with the switch off, a local
   run gives a 404 and no menu.
2. Bundle A: migration 0144, then the tabs in order Overview, Drawings, Defects, Timeline, Calendar, Payments + To do,
   Site & photos.
3. Bundle B: migration 0145, then the VO, PO and Client PO tabs (staff side), quantity rules settings, client PDF.
4. Bundle C: migration 0146, client link + public page, light ticks, replace pages + compare.

Each step: `tsc --noEmit` on backend and frontend, unit tests for the pure parts (quantity rules, defect state,
approved-set choice, token hashing / scoping), the related existing renovation tests, then one PR into `main`,
shown to the owner on staging before merge. Migrations: dry-run then apply to staging only.

New files (all under `engine/`):
- backend: `scm/lib/renovation-beta-enabled.ts`, `routes/renovationBeta.ts`, `routes/renovationBetaPublic.ts`,
  `services/renovation/beta/*.ts` (workspace read, defects, drawings, quantities, client link), tests beside them.
- frontend: `pages/renovation-beta/*` (list, workspace, one file per tab, client link page), `lib/renovation-beta/api.ts`.
Changed: `backend/src/index.ts` (mount 2 routers), `routes/auth.ts` (flag), `wrangler.toml` (var),
`frontend/src/App.tsx` (routes), `components/Sidebar.tsx` (group).

## 7. Risks and rollback

- Production exposure: the only production-facing change is a menu entry and routes that answer 404 while the switch is
  off. A unit test checks that every Beta route answers 404 with the switch off.
- The client link is the one public write. If anything goes wrong, set `BETA_ENABLED` to false on staging (one line,
  redeploy) and every link stops at once. Revoke single links from the workspace.
- Rollback: turn the switch off. To remove Beta completely, revert the PRs, then a new migration drops the Beta tables and columns.

## 8. Open questions (defaults used unless the owner says otherwise)

- Client link lifetime: 120 days, or until handover + 30 days, whichever comes first.
- Client approval of the 2D is recorded in Beta (`project_design_file_approvals`). The existing "shop drawings signed"
  checklist item that opens the site-works gate is separate. Default: Beta also ticks that checklist item when the
  approval is for the 2D, so staff enter it once. The alternative is to keep them apart and enter it twice.
- Starter quantity rules: the board 24 sqft and spare 5% come from the mockup. The tee and paint coverage numbers are
  placeholders until the owner gives real ones.

## 9. Bundle A contract (23 Oct 2026)

Changes from section 3, agreed while building: the migration is numbered 0146 (0143 to 0145 are taken by the
workers work on staging). `project_beta_reminders` and `project_design_sent` are dropped: every Beta action writes a
`project_activity` row (actions `beta_*`), which the existing timeline already reads, and the sent / due / approval
dates live in one table, `project_design_file_reviews`.

### Migration `migrations-pg/0146_beta_workspace_a.sql`
- `project_defects` gains `trade text` (null, or one of carpenter, electrician, plumber, painter, plaster, hacking,
  aircon, tiler, other), `fixed_at timestamptz`, `fixed_by bigint`, `after_photo_r2_key text`, `redo_count integer not null default 0`.
- `project_design_file_reviews`: `file_id bigint primary key references project_design_files(id) on delete cascade`,
  `project_id bigint not null references projects(id) on delete cascade`, `company_id bigint not null`, `sent_on date`,
  `due_on date`, `sent_by bigint`, `approved_on date`, `approved_by_name text`, `approval_note text`,
  `approval_recorded_by bigint`, `updated_at timestamptz not null default now()`; index on project_id.
- `project_beta_settings`: `company_id bigint primary key references companies(id)`, `design_3d_days integer not null
  default 10 check (between 1 and 365)`, `design_2d_days integer not null default 12 check (between 1 and 365)`,
  `updated_by bigint`, `updated_at timestamptz not null default now()`.
- Each new table: `owner to scm_engine` and `enable row level security`, as in 0121. First line `-- REVERSAL: ...`.

### Server: `engine/backend/src/routes/renovationBeta.ts`, mounted at `/api/beta` after the auth gate
First middleware on every route: `if (!isBetaEnabled(c.env)) return c.json({ error: "not_found" }, 404)`.
Every project-scoped route checks the project belongs to the active company the same way `POST /:id/key-moves` in
`routes/renovationProject.ts` does (404 otherwise); defect and design-file routes look up their project first and do
the same. Reads: `requirePageAccess("projects.list")`. Writes: `requirePermission("projects.write")`. Settings write:
`requirePermission("projects.manage")`. Every write also inserts a `project_activity` row (same columns as
`logActivity` in `routes/renovation.ts`).

| Method, path | Body | Answer | Activity action |
|---|---|---|---|
| GET `/projects/:id/workspace` | | `BetaWorkspace` (below) | |
| PUT `/settings` | `{ design3dDays, design2dDays }` (whole days 1..365) | `{ ok: true }` | none |
| POST `/projects/:id/defects` | `{ location, description, trade, dueDate, photoKey }`; description and photoKey required; photoKey must start with `renovation/<id>/`; trade from the list or null; dueDate YYYY-MM-DD or null | `{ id }` 201 | `beta_defect_reported` (to_value = description) |
| POST `/defects/:defectId/fixed` | `{ afterPhotoKey? }` (same prefix rule) | `{ ok: true }`; 409 if closed or already fixed | `beta_defect_fixed` |
| POST `/defects/:defectId/redo` | `{ note? }` | clears fixed_at, fixed_by and the after photo, redo_count + 1; 409 unless fixed and open | `beta_defect_redo` |
| POST `/defects/:defectId/close` | | sets closed_at, closed_by, resolved = 1 (as the existing snag close); 409 if closed | `beta_defect_closed` |
| POST `/design-files/:fileId/sent` | `{ sentOn, dueOn }` (dates; dueOn not before sentOn) | upsert review; `{ ok: true }` | `beta_drawing_sent` (to_value e.g. "2D v3") |
| POST `/design-files/:fileId/approval` | `{ approvedOn, approvedByName, note? }` | upsert review; when the file is 2D, also mark the project's checklist item `shop_drawings_signed` done, the same write as the existing checklist status route | `beta_drawing_approved` |
| DELETE `/design-files/:fileId/approval` | | clears the approval fields (the checklist item is left as it is) | `beta_drawing_approval_removed` |
| POST `/projects/:id/reminders` | `{ kind, text }`: kind one of client_approval, client_answer, defect, payment; text 1 to 1000 chars | `{ ok: true }` | `beta_reminder` (to_value = kind, note = text) |

New defects use phase `snag`, so the existing handover rule (every snag closed before handover) counts them.

```ts
export interface BetaWorkspace {
  settings: { design3dDays: number; design2dDays: number };          // defaults when no row
  reviews: Array<{ fileId: number; sentOn: string | null; dueOn: string | null; approvedOn: string | null;
                   approvedByName: string | null; approvalNote: string | null }>;
  defects: Array<{ id: number; phase: string; location: string | null; description: string | null;
                   trade: string | null; dueDate: string | null; reportedAt: string | null; reportedByName: string | null;
                   photoKey: string | null; afterPhotoKey: string | null; fixedAt: string | null; closedAt: string | null;
                   redoCount: number }>;                               // not archived, oldest first
  payments:
    | { state: "hidden" }                                              // financeHiddenForUser
    | { state: "none" }                                                // no live SO, or billing unavailable
    | { state: "ok"; contractSen: number; receivedSen: number;
        instalments: Array<{ seq: number; label: string; amountSen: number; paidSen: number;
                             status: "paid" | "billed" | "not_billed"; stageCode: string | null; trigger: string }> };
}
```
Payments come from `billingViews` (`scm/lib/renovation-billing.ts`) for the project's live renovation SO.
`paid` = bill exists and paidSen covers the bill amount; `billed` = bill exists, not fully paid; `not_billed` = no bill.

`services/renovation/timeline.ts` `activityText` gains readable titles for the `beta_*` actions.

### Screens: `engine/frontend/src/pages/renovation-beta/`
Existing calls are reused, not copied: `simpleApi.detail`, `simpleApi.designRecords`, `simpleApi.keyLog` /
`addKeyMove`, `renovationApi.pod` (site receipt photos), `renovationApi.upload` / `fileUrl` and `AuthImage` (photos),
`timelineApi` (timeline). New: `renovationBetaApi.ts` (the routes above), `renovationBetaModel.ts` (pure logic, tested).

| Tab | Shows |
|---|---|
| Overview | Payments strip (each instalment, paid / billed / not billed, the step it unlocks), To do card, site progress (site tasks from the detail), design progress with deadlines (3D due = first site measure + design3dDays; 2D due = 3D approval + design2dDays), key holder with "Key passed" (existing key move), the SO and team. |
| Drawings | 3D and 2D: approved set (newest version with an approval), a newer version waiting for the client (sent and due dates), Send to client (records sent and due, offers WhatsApp to the customer), Record approval, Remove approval, all versions with their notes. |
| Site & photos | One feed newest first: site receipt photos (pod), onsite visit files, defect photos (before and after). Filter by room where known (defect location). |
| Defects | Report a problem (photo required, area, what is wrong, who fixes it, fix by), three columns To fix / Check it / Done, late days, Fixed (with optional after photo), Redo, OK close, Remind (WhatsApp text plus a reminder record), "N of M closed" for handover. |
| Timeline | The existing timeline entries with a search box, a RECORD tag on approvals, key passes and handover, and Export (CSV download). |

To do (pure function, tested): a 2D or 3D version sent and not approved (due date, Remind client); the next
not-paid instalment whose step is reached or next (Ask Sales via WhatsApp, no phone); defects past their fix-by date;
design deadline within 3 days or past. Each row has one action.

WhatsApp: `https://wa.me/<digits>?text=<encoded>` with the customer's phone when known (Malaysian numbers starting
with 0 become 60...), else `https://wa.me/?text=<encoded>`. Pressing Remind also calls POST `/reminders`.

## 10. Home, Projects and Calendar in the mockup's own format (owner, 23 Oct 2026)

The owner: "for beta do Home, Project and Calendar together" and "follow the format they made, don't make it
yourself". The Beta screens copy the mockup's layout, wording, order and colours. The reference set (not committed)
is in the scratchpad folder `mockup/`: `body.html` (the mockup's markup with its inline styles; the three areas are
`id="homeArea"`, `id="projectArea"`, `id="calendarArea"`), `app.js` (its logic: `status`, `stage`, `rounds`,
`items`, `apptItems`, `nextFor`, `renderHome`, `renderDeadlines`, `renderProg`, `renderCal`, the modal forms),
`styles.css`, and screenshots `home.jpg`, `home-phone.jpg`, `project-overview.jpg`, `calendar-deadlines.jpg`,
`calendar-progress.jpg`, `calendar-month.jpg`. Colours come from `renovationBetaTheme.ts` (the mockup's palette).
Real data replaces the mockup's sample data; nothing the mockup shows is invented beyond it.

### Menu
- Engine sidebar Beta group and the Property OS BETA group: **Home** (`/beta/home`), **Projects** (`/beta/projects`),
  **Calendar** (`/beta/calendar`), in that order, same switch as before.
- Projects opens the last project opened in Beta (remembered in localStorage per browser); with none, it opens Home.
  The step 1 list page is replaced by Home. A project still opens at `/beta/projects/:id`.

### Migration `migrations-pg/0147_beta_home_calendar.sql`
- `project_beta_design`: `project_id` pk (projects, cascade), `company_id`, `start_3d_on date`, `start_2d_on date`,
  `person_3d_id`, `person_2d_id` (project_people, set null), `po_done_on date`, `updated_by`, `updated_at`.
- `project_beta_note_days`: `note_id` pk (project_design_notes, cascade), `days integer not null check 1..60`.
  An amendment round lasts `days`, 3 when there is no row (the mockup's default, editable per round).
- `project_beta_appointments`: `id`, `project_id` (cascade), `company_id`, `kind` (`site_measure`,
  `carpentry_measure`, `site_briefing`), `on_date date not null`, `at_time time`, `person_id` (people, set null),
  `with_text text`, `done_at timestamptz`, `created_by`, `created_at`; unique (project_id, kind).
- `project_beta_events`: `id`, `company_id`, `project_id` (null for internal work; cascade), `on_date date not null`,
  `at_time time`, `type` (`client`, `measure`, `briefing`, `meeting`, `w3d`, `w2d`, `amend`, `po`, `update`),
  `note text`, `person_id` (people, set null), `done boolean not null default false`, `created_by`, `created_at`,
  `updated_at`; index (company_id, on_date).
- Same conventions as 0146 (REVERSAL line, owner scm_engine, RLS on, revoke from anon / authenticated).

### Server: added to `routes/renovationBeta.ts` (same switch, scoping, permissions, activity rows as section 9)
| Method, path | Body | Answer |
|---|---|---|
| GET `/board?from=&to=` | dates; default today - 60 .. today + 180; at most 400 days | `BetaBoard` (below) |
| PUT `/projects/:id/design` | any of `start3dOn`, `start2dOn`, `poDoneOn` (date or null), `person3dId`, `person2dId` (company person or null) | `{ ok: true }` |
| PUT `/design-notes/:noteId/days` | `{ days }` 1..60 | `{ ok: true }` |
| PUT `/projects/:id/appointments/:kind` | `{ onDate, atTime, personId, withText }` | upsert, `{ ok: true }` |
| POST `/projects/:id/appointments/:kind/done` | | sets done_at, `{ ok: true }` |
| DELETE `/projects/:id/appointments/:kind` | | `{ ok: true }` |
| POST `/events` | `{ projectId, onDate, atTime, type, note, personId }` | `{ id }` 201 |
| PATCH `/events/:id` | same fields plus `done`, all optional | `{ ok: true }` |
| DELETE `/events/:id` | | `{ ok: true }` |
Reused, not rebuilt: "+ Amendment" = existing POST `/api/renovation/:id/design-notes`; "Client approved" = section 9
approval on the newest file of that kind (409 when there is no file); "Assign" = existing PATCH
`/api/renovation/:id/people` (designer = design lead, pic = site PIC) plus PUT `/design` for the 3D and 2D people.

```ts
export interface BetaBoard {
  today: string; mePersonId: number | null;                 // the person whose user_id is the signed-in user
  settings: { design3dDays: number; design2dDays: number; amendmentDays: 3 };
  people: Array<{ id: number; name: string; roles: string[] }>;          // active
  projects: Array<{
    id: number; code: string | null; name: string; building: string | null; unitNo: string | null;
    customerName: string | null; salesName: string | null; createdOn: string | null; handoverOn: string | null;
    lead: { id: number; name: string } | null;               // projects.designer_person_id
    person3d: { id: number; name: string } | null; person2d: { id: number; name: string } | null;
    sitePic: { id: number; name: string } | null;            // the project PIC, else the renovation PIC
    measuredOn: string | null;                               // first site measure record
    start3dOn: string | null; start2dOn: string | null; poDoneOn: string | null;
    files: Array<{ id: number; kind: "3d" | "2d"; version: number; submittedOn: string }>;
    notes: Array<{ id: number; kind: "3d" | "2d"; notedOn: string; closedOn: string | null; days: number | null }>;
    reviews: Array<{ fileId: number; sentOn: string | null; approvedOn: string | null }>;
    appointments: Array<{ kind: "site_measure" | "carpentry_measure" | "site_briefing"; onDate: string;
                          atTime: string | null; personId: number | null; withText: string | null; doneAt: string | null }>;
    payment: { state: "hidden" } | { state: "none" } | { state: "ok"; label: string };
  }>;                                                         // renovation projects, not archived, active company
  events: Array<{ id: number; projectId: number | null; onDate: string; atTime: string | null; type: string;
                  note: string | null; personId: number | null; done: boolean }>;
}
```
Payment label: the first instalment not paid: billed and not paid gives "Pending 2nd payment" (its ordinal), not
billed gives "2nd payment"; every instalment paid gives "Fully paid"; no live SO gives state none ("No payment").
Billing is read once for all projects (`billingViews` takes many SOs), never per project.

### Mapping the mockup's project fields to the data (pure function `renovationBetaBoard.ts`, tested)
- `who` (design lead) = lead; `unassigned` = no lead. `who3` = person3d or lead; `who2` = person2d or lead;
  `site` = sitePic name; `handover` = handoverOn; `po` = poDoneOn; `msr` / `cm` / `sb` = the appointments.
- `s3` = start3dOn, else (when a 3D file exists) measuredOn, else the first 3D file's day. `done3` = the first 3D
  file's submittedOn. `ok3` = a 3D file with an approval. `am3` = 3D notes in date order:
  `{ s: notedOn, days: days ?? 3, done: closedOn }`. Same for 2D, where `s2` falls back to the 3D approval day.
- `measured` = measuredOn, or the site measure appointment done or past, or s3.
- Everything else (`status` A to E with its words, `stage`, `rounds`, `items`, `apptItems`, `nextFor`, waiting for
  client, ready to start, to book / to do, the six progress steps) follows `app.js` exactly. SOP days come from
  settings (10 and 12), the amendment default is 3.
- "Viewing" starts on the signed-in person (mePersonId), else All; the people list is `people`.
- "Who can assign": users with projects.write (the mockup limits it to the design lead).
- Left out on purpose (later bundles): the bell, the "Drawing updates" alert and site "Received" (they need bundle C's
  page replacement), Customers / Procurement / Construction / Finance / Files / Settings menu items.

### Screens
- Home (`RenovationBetaHome.tsx`): exactly `renderHome`: title "All projects", counts, the five tabs with counts,
  the table (Building tag, Project · customer, ID condition pill, Who now with Assign, Due, Payment) on desktop and
  the cards under 720px, footer "N shown · tap a project to open it". A row opens `/beta/projects/:id`.
- Calendar (`RenovationBetaCalendar.tsx`): title "Calendar", "Deadlines follow the ID SOP: 3D in 10 days, 2D in 12
  days" (numbers from settings), Viewing select, the Deadlines / Progress / Calendar switch, and each view as
  `renderDeadlines`, `renderProg`, `renderCal`, with their buttons and the forms (`workForm`, `assignForm`,
  `bookForm`, `amendForm`) as dialogs. "+ Add project" opens the existing new project form.
- Projects workspace: the existing tabs restyled to `projectArea`: header (name in capitals, code, scope, handover
  with days left, the team chips with Design lead + WhatsApp, 3D, 2D, Site PIC and Assign), the stage stepper
  (Sales order, Design, Ordering, Renovation with "Day N of M", Handover, Closed with their dates), the tab bar, and
  each tab's cards as in the mockup. Data and actions stay as built in bundle A.
