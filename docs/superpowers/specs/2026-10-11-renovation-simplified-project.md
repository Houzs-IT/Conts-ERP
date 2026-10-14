# Renovation project, simplified (owner decisions 11 Oct 2026)

Status: approved by the owner in chat, 11 Oct 2026. Overrides the 11-stage presentation of
`2026-10-09-renovation-flow-design.md` section 5 wherever they disagree; the stage, checklist and
gate machinery from that design stays underneath and keeps working.

## 1. Decisions

| # | Decision |
|---|---|
| 1 | The project is an aggregator. Each fact is entered once, in its own module: the sales order (quotation, signing, VO, payments all live under the SO: has an SO = signed), purchase orders (supplier and subcontractor ordering), GRN / site receipt / DO (arrival), site tasks. No BOM. No production order module: in-house work is a site task assigned to in-house crew. |
| 2 | Main flow = 6 steps, stored as rows per company (label, order, active), editable in Project Maintenance: 1 Design (project exists), 2 Signed (a live renovation SO is linked), 3 Ordering (SO lines split into POs), 4 Renovation (a site task started), 5 Handover (customer signed the handover), 6 Closed (handed over and fully paid, or closed by hand). |
| 2a | The current step is derived from module data. Staff may move a project to any step by hand (forward or back) with an optional reason; who and when are logged. A manual step holds until the data moves past it (past both the manual step and the step the data was on when it was set); "Follow data" clears it. |
| 2b | A separate hold flag (`in_defect` / `on_hold`) can be set and cleared at any time and shows wherever the step shows. |
| 3 | Records, not steps: design (site measure date + who; 2D/3D files in one place, many versions, who/when), unit key (who passed to whom on which date; board shows the current holder), payments (read from the SO only: contract total incl. VOs, received so far and % of total), VO (yes / count from the SO). The project stores no payment field. |
| 4 | One people master per company (name, roles Sales / Designer / Renovation PIC / Admin / Boss / Site crew, active, optional engine user link), managed in Project Maintenance. Every "pick a person" field uses it. Superseded 14 Oct 2026: people come from the Property OS user accounts (see below). |
| 5 | SO and project: either may come first. From a project: create a quotation (existing quotation -> convert path) or link an existing SO. From an SO: pick a project, or create a project from the SO. Linking later integrates everything (contract, quotation, site tasks, cached stage). One live SO per project stays. Unlink only while nothing downstream depends on it. |
| 6 | Site task vocabulary = Notion's categories (study section 2.2), one table, Notion wording, mapped onto WORKS sub-categories or template tasks; three WORKS sub-categories added (PARTITION, FEATURE_WALL, DOOR) with their RN- SKUs. Several tasks of one category per project are allowed (occurrence). |
| 6a | A site task is fulfilled by a PO (subcontractor / supplier; completes on receipt) or by in-house crew (one or more people with role Site crew, no PO; ticked done). Assignees show on the task, the calendar and the lists. |
| 7 | Board columns: Building, Project, SO no., Sales, Contract total, Received (%), Status (step + hold flag), Furniture / Reno-item arrival (Pending purchased / Pending arrived / All arrived), Key holder, VO, Handover date. Phone: cards. |
| 8 | Every new or changed record kind carries `source` ('app' / 'import') and `source_ref` (Notion page id) with a unique (company_id, source_ref) where not null, so the Notion importer can upsert idempotently: projects, people, key moves, design records, design files, site tasks. |

## 2. Data model (migrations 0083-0086)

### 0083 people, steps, records
- `public.project_people`: id, company_id, name, roles text[] (subset of `sales, designer, reno_pic, admin, boss, site_crew`), active, user_id (engine user, optional), phone, notes, source, source_ref.
- `public.project_flow_steps`: company_id, step_key (`design, signed, ordering, renovation, handover, closed`; fixed meaning), label, sort_order, active. Seeded per company with the six defaults.
- `public.projects` gains: sales_person_id, designer_person_id, reno_pic_person_id (-> project_people); flow_manual_step, flow_manual_base_step, flow_manual_reason, flow_manual_by, flow_manual_at; hold_flag (`in_defect` / `on_hold`), hold_note, hold_by, hold_at; source, source_ref.
- `public.project_flow_log`: project_id, kind (`manual_step`, `follow_data`, `hold_set`, `hold_cleared`), from_value, to_value, reason, user_id, person_id, at, source, source_ref. History of every hand move and hold change. Derived step changes are not stored (they are read-time).
- `public.project_key_moves`: project_id, moved_on, from_person_id, to_person_id, note, recorded_by, source, source_ref. Current holder = `to_person` of the latest move.
- `public.project_design_records`: project_id, kind (`site_measure`), done_on, person_id, note, source, source_ref.
- `public.project_design_files`: project_id, kind (`2d`, `3d`, `other`), version, file_name, content_type, size_bytes, r2_key or external_url (one of them), person_id (who drew it), uploaded_by, uploaded_at, note, source, source_ref.

### 0084 site tasks
- `public.project_task_categories`: company_id, code, label (Notion wording), stage_key, trade_code (WORKS sub) or internal_key (template task) or neither, fix_phase, trade_default, sort_order, active, notion. Seeded per company from `TASK_CATEGORIES` (`renovation-stages.ts`, parity test).
- `public.project_trade_tasks` gains category_code, occurrence (default 1), source, source_ref. Unique index becomes (project_id, trade_code, fix_phase, occurrence). The internal check is relaxed: an `INTERNAL:` task is always `internal`; any other task may be `po` or `internal` (in-house crew); an internal task never has a PO. Task code `CAT:<code>` for categories with no trade and no template task (curtain, furniture delivery, carpentry...).
- `public.project_trade_task_assignees`: task_id, person_id, company_id. In-house crew of a task.

### 0085 catalog
WORKS sub-categories PARTITION, FEATURE_WALL, DOOR and their generic SKUs RN-PARTITION, RN-FEATURE_WALL, RN-DOOR.

### 0086 SO without a project
`scm.reno_quotations.project_id` and `scm.reno_so_contracts.project_id` become nullable. `uq_mfg_so_reno_project` (one live renovation SO per project) is unchanged.

## 3. Rules
- Step derivation (pure, `services/renovation/flow.ts`): furthest active step whose condition holds. design: always; signed: live renovation SO; ordering: a live PO line on the SO's items; renovation: a site task in progress or done (state or actual start), or a site receipt; handover: handover signed; closed: handed over and received >= contract total (> 0), or `projects.closed_at` set.
- Manual: effective = manual while derivedIndex <= max(manualIndex, baseIndex); otherwise the data wins and the manual step reads as released.
- Unlink an SO: refused when the handover is signed, a PO line on the SO's items is received, or a site task linked to its lines is started or done. Otherwise the SO, contract and quotation lose the project id, the task links of its lines go, and auto-created PO tasks left with no line and never touched are removed.
- Payments on the project: contract total = revised contract sum (SO lines incl. VOs), received = billing view received. Never stored.

## 4. Read APIs for the monitor and the importer
- `GET /api/renovation/board-rows` - board rows with the fields of decision 7.
- `GET /api/renovation/people?role=&active=` - people master.
- People from user accounts (owner, 14 Oct 2026, migration 0113): pos.users gains department and position (Users and roles page). The engine reads the staff accounts through the view public.conts_staff (the only thing in schema pos granted to scm_engine; owner logins left out). Each GET /people first brings project_people in line with the accounts (services/renovation/peopleSync.ts): one row per account via project_people.pos_user_id, following the account's name and active state; an unlinked person is linked only on an exact name match ignoring case and spacing, unique on both sides. Rows come back with position, department and `offered` (linked to an active account); pickers offer only those and label them "Name · Position · Department". Imported people that are not accounts keep their names on old records. Before 0113 the list behaves as before.
- `GET /api/renovation/key-log?projectId=` - key moves (all projects or one).
- `GET /api/renovation/design-records?projectId=` - site measures and files.
- `GET /api/renovation/:id/step` - current step, derived step, manual step, hold flag, step list, history.

## 5. Not here
Project Monitor hub page and the Notion importer (other agents). Production orders (dropped by the owner).

## 6. Owner changes, 14 Oct 2026 (migration 0111)
- People on the screen: Project PIC (one person, projects.reno_pic_person_id) and Attending (several, public.project_attendees), both from project_people. sales_person_id / designer_person_id stay for their other readers and were copied into Attending once. GET /:id adds people.pic and people.attending; PATCH /:id/people takes picPersonId and attendingPersonIds (the whole set), each change logged in project_activity.
- Projects list and calendar are the original screens again in renovation mode; a renovation project still opens its own detail and New Project opens the renovation form. RenovationBoard / RenovationCalendar stay in the code, unrouted.
- Design is the main task, at the top of the left column: Onsite (site measure: date + PIC) -> 3D (link submissions: date, 3D PIC, 2D PIC = project_design_files.next_person_id; notes log) -> 2D (link or file, date, PIC; notes log). Notes: public.project_design_notes. POST /:id/design-links, POST /:id/design-notes; uploads take submittedOn.
- Unit key card: holder with days held, every move in a table, an always-open add row (received by required, passed by optional).
- Procurement details replace the stage-details section: PO date + delivery date per product category and sub-category (public.project_procurement_dates, sub_code  = category). A sub-category follows its category (mode follow), has its own dates (own) or none (none); effective dates are computed in services/renovation/procurement.ts. GET /:id/procurement, PUT /:id/procurement/:group, PUT /:id/procurement/:group/:sub. They will drive automatic POs later; not yet. The stage, checklist and gate APIs are unchanged; the billing prompt shows above the columns.
- Snag list and handover form were removed from the detail page; their APIs and data are unchanged.
- Calendar (owner ruling, 14 Oct): GET /api/projects/calendar/events also returns renovation projects without dates, each from its created date (Malaysia time) to the planned handover; else the actual handover; else created + project_types.sla_days when that column exists; else 45 days with end_estimated = true (shown as "end estimated"). Nothing is stored. Every calendar entry (menu Schedule / Calendar, ?view=calendar, ?view=monitor, the phone Calendar tab and the phone monitor link) opens the original calendar; RenovationCalendar is only inside the unrouted ProjectMonitor.

## 7. Owner feedback after go-live, 14 Oct 2026 (migration 0114)
- Unit key: "+ Record key pass" opens a one-row form (Date / Passed by, prefilled with the holder / Received by), Add below; every move can be edited or deleted (confirm), PATCH / DELETE /api/renovation/key-moves/:id, logged in project_activity. Messages show inside the card.
- Design card is a stepper (done / in progress / not started) with a status in its header; the whole step row opens it, the current step opens by default, several may be open. Lists show history first; add forms open from "+" buttons (open from the start only while a list is empty), prefill the PICs of the latest entry, and open as a bottom sheet on a phone. Every version and Onsite entry can be edited (PATCH /design-files/:id, PATCH /site-measures/:id).
- Onsite: several PICs (project_design_record_people), a remark, and photos / files (project_design_record_files, POST /:id/site-measures/:recordId/files). 3D: several 3D PICs (project_design_file_people). person_id keeps the first PIC for single-person readers.
- 2D: V1..Vn by submit date; a "2D amendment request" puts 2D in Amending; the next 2D version closes every open request (project_design_notes.closed_by_file_id / closed_at). Rules in designModel.ts.
- Procurement: no mode dropdown; typing a sub-category date makes it its own, emptying both means no dates, "follow category" resets; "Show only changed".
- Layout: left = work (Design, Procurement, Site tasks), right = reference (Team, Key, Contract, Documents). Attending shows "Name · Position" (personPosition, roles today).
