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
