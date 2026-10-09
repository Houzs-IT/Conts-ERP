# Phase 3 (Project) implementation plan

Spec: `docs/superpowers/specs/2026-10-09-renovation-flow-design.md` section 5.
Shared names are fixed in `2026-10-09-integration-contract.md`; that file wins on any conflict.

## Findings that shape the plan
1. No `scm.job_progress` / `delivery-job-progress.ts` in this engine copy. POD exists only on delivery orders (`delivery_orders.pod_r2_key`, `signature_data`, `pod_lat/lng/accuracy_m/located_at`, 0044:1398,1454, check :4923), written by `MobilePOD.tsx:203-216`.
2. Engine vitest configs import `../scripts/coverage-areas.mjs`, which is missing; restore from `C:\Users\User\Desktop\houzs-erp-local\scripts\coverage-areas.mjs`. No `node_modules` installed.
3. New tables need `OWNER TO scm_engine`, RLS enabled, `REVOKE ALL FROM anon, authenticated` (0047 handed ownership only once).
4. Free Workers plan: 50 outside calls per request. New project logic reads/writes through `c.env.DB` (Hyperdrive, `db/d1-compat.ts:509-522` batch), not supabase-js REST.
5. Engine cannot read schema `pos`: owner/unit links are opaque `pos_owner_id` / `pos_unit_id` plus copied building/unit text. Field roles cannot sign on to the engine (`functions/_lib/scmEngine.ts:13`).
6. Project create still needs brand/state/venue (`services/project-naming.ts:51-53`, `CreateProjectPanel.tsx:88-93,147-149`).
7. A site receipt must not book stock: GRN post writes stock IN (`grns.ts:540-657`), also cancel/edits (`:2321, 2522, 2852, 3160, 3353`) and purchase returns (`purchase-returns.ts:525, 686`).
8. `isServiceLine` (`scm/shared/service-sku.ts:101-107`) treats SERVICE as a freight pool (`grns.ts:529-539`); WORKS must not be classed as service.
9. `routes/projects.ts` is at its size ceiling; new routes go in new `renovation` files.
10. Property OS Projects menu already exists (`src/lib/navigation.ts:76-81`, `ENGINE_ONLY_AREAS` :144, mapped in `src/lib/scmEngine.ts:9-12`).

## DB (migrations-pg 0075-0084)
- 0075 `public.projects`: `project_kind` ('exhibition'|'renovation', existing rows exhibition, new default renovation), `project_type_id`, `customer_kind` ('owner'|'customer'), `customer_id` -> `scm.customers`, customer name/phone/email, `pos_owner_id`, `pos_unit_id`, `building`, `unit_no`, `site_address`, `reno_stage`, `signed_at`, `planned_handover_date`, `handed_over_at`, `closed_at`; indexes. Exhibition columns kept, hidden in UI; `stage` written draft/setup/completed for calendar compatibility.
- 0076 `public.project_types` (slug, name, `stage_keys text[]`, checklist template, sort, active, company) and `public.project_stages` (project, `stage_key` in the 11 keys, seq, `in_type`, `state` not_started/in_progress/done/skipped, started/done actor+time, skip reason/actor/time with CHECK, planned dates, unique project+stage). Stored state = human decisions only; auto/type skips derived on read.
- 0077 checklist: `project_kind` on templates; `stage_key` on template sections and sections; `item_key`, `evidence_hint`, `skippable` on template items and checklist rows; skip reason/actor/time on checklist rows; partial unique `(project_id, item_key)`.
- 0078 `public.project_trade_tasks` (stage_key default hardware, trade_code, fix_phase single/first/second, seq, supplier, PO, state + skip, planned/actual dates, `completed_by_grn_id`) and `public.project_trade_task_lines` (task, `so_item_id`, `purchase_order_item_id`).
- 0079 `scm.grns`: `received_at_site`, `project_id`, `site_received_at`, site lat/lng/accuracy/located_at, `supervisor_user_id`, `supervisor_signature_r2_key`, `customer_signer_name`, `customer_signature_r2_key`, `site_notes`, range and completeness CHECKs; `scm.grn_site_photos` (grn, grn_item, project, location, kind in_place/supplier_do/before/after/defect/other, r2_key, caption, taken_at, uploaded_by).
- 0080 `public.project_handovers` (one per project; customer signer + signature, staff, signed_at, keys/cards returned, deposit refund note, GPS); `project_defects` add `stage_key`, `location`, `due_date`, `closed_at`, `closed_by` (phases `defect_check`, `snag`).
- 0081 `public.assr_cases.project_id`.
- 0082 seeds: `app_settings projects_mode=renovation`; types `full_renovation` (11 stages), `airbnb_package` (no hardware, defect_check), `carpentry_only` (no hardware, appliances, soft_furnishing) with checklist templates and item keys per spec section 5 (`renovation_permit` skippable gate item; `shop_drawings_signed`, `handover_signed` not skippable).
- 0083, 0084 spare.

## BE
- Shared `scm/shared/renovation-stages.ts` (+ frontend mirror with canonical test): `RENO_STAGES`, labels, `UNSKIPPABLE = design, handover, closed`, group -> default stage, auto-skip rules, `TRADE_ORDER`.
- Pure services `services/renovation/`: `stages.ts` (`deriveStageViews`, precedence manual > type > auto > reopened > stored; line ownership moves off skipped stages; `nextNonSkipped`, `currentStage`), `gate.ts` (`evaluateHardwareGate`: so_not_confirmed, instalment1_unpaid, shop_drawings_unsigned, permit_pending; null facts -> closed), `billing.ts` (`effectiveInstalmentStage`, `billingPrompts`), `tradeTasks.ts` (`planTradeTasks`, `tradeTaskStatus`; electrical first+second fix; VO omission auto-skips), `pod.ts` (`podCoverage`, `groupEvidence`), `redFlags.ts`.
- I/O: `load.ts` (`loadRenovationFacts`, ~8 set-based `env.DB` queries; missing phase-2 tables -> `billing.available=false`, other errors throw -> 409 fail closed), `create.ts` (`createRenovationProject`, code `RN-YYMM-NNN`, no brand/venue, seeds finance, stages and checklist in one batch).
- New `routes/renovation.ts` at `/api/renovation`: types; create; board list; detail (finance stripped unless `pms.canFinancial`); stage start (hardware gate 409 with reasons) / complete (blockers) / skip with reason (min 3 chars, unskippable refused) / unskip / planned dates; checklist skip; trade-task sync/start/skip; handover (refused while snags open); POD view + print; upload/file (R2 `renovation/{projectId}/...`, company-checked).
- `routes/projects.ts:3682-3766`: renovation item `na` without reason -> 400 `use_skip_with_reason`; list `?kind=`.
- New `scm/routes/site-receipts.ts` (area guard `scm.procurement.grn` + `projects.write`): GET open PO lines for the project; POST (Idempotency-Key) validates lines belong to the project SO, hardware gate for WORKS, photo + supervisor signature rules, drafts via `createDraftGrnsFromPoItemsCore`, stamps POD + photos in one batch, posts via exported `postGrnAndRollup`; GET POD detail.
- `grns.ts`: export `postGrnAndRollup`; `received_at_site` skips allocation and stock movements; `grnBooksStock(header)` guard on cancel/PATCH/line edits; POD on GET. `purchase-returns.ts`: skip stock-out for site-received lines.

## FE (`engine/frontend/src/pages/projects/renovation/`)
`renovationApi.ts`, `renovationModel.ts`, `RenovationBoard.tsx` (card list on phone), `RenovationDetail.tsx` with `BillingPromptBanner`, `StageTimeline` (horizontal desktop / vertical phone), `StageChecklist`, `SkipReasonDialog`, `TradeTasksPanel`, `EvidenceGallery` (by room, `MediaLightbox`), hardware gate card, `HandoverPanel`, warranty list, `LinkedDocumentsPanel`, `ProjectChat`; `CreateRenovationPanel.tsx` (no brand/event type/venue). `Projects.tsx` switches to the board and detail by `projects_mode` / `project_kind`; Gantt hidden for renovation. `ProjectMaintenance.tsx`: `ProjectTypeManager`, stage selector per template section, hide Organizers/Venues/Event Types/Cost Rates, keep Brands. Mobile: `MobileSiteReceipt.tsx` (MobilePOD patterns: signature rule, GPS timestamp, upload first), `MobileRenovationProject.tsx`, `MobileApp.tsx` screen. `GoodsReceivedDetailV2.tsx` site-receipt panel.

## Task order (test-first)
1 tooling; 2 stage vocabulary; 3 deriveStageViews; 4 gate; 5 billing; 6 trade tasks; 7 POD; 8 red flags; 9 migrations dry-run/apply staging; 10 load/create; 11 move `canCreateEvent` to `projectGates.ts`; 12 read routes; 13 stage writes; 14 checklist skip + `na` refusal; 15 trade tasks routes; 16 upload/file; 17 GRN site-receipt stock guards + source-slice test; 18 site receipts; 19 handover; 20 POD + print; 21-26 frontend; 27-28 mobile; 29 GRN detail panel; 30 `scripts/api-checks/renovation-project.mjs`; 31 `CLAUDE.md` divergence note + `TODO.md`.

## Verification
- `cd engine/backend && npx vitest run --config vitest.light.config.mts tests/renovation* tests/grnSiteReceipt* tests/siteReceipt* && npm run typecheck`
- `cd engine/frontend && npx vitest run src/pages/projects src/mobile/MobileSiteReceipt.test.tsx src/vendor/scm/lib && npm run typecheck && npm run build`
- migrations dry-run on staging (ref `ecgyrmblqfxvbfjlqkdq`), then apply
- api-check script against local engine on staging data
- Browser desktop and 375x812: board, timeline, skip dialog refusal, gate reasons, evidence by room, create form, phone site receipt end to end, GRN site panel, no console errors.

## Owner input from his Notion boards (9 Oct) — overrides the above where they differ
- No "previous trade must finish" rule: `TRADE_ORDER` only lays out new tasks; drop sequencing blockers from `tradeTaskStatus`/stage completion; keep overdue flags.
- Template tasks from `INTERNAL_TASKS` (`trade_code 'INTERNAL:<key>'`, `fulfilment_kind 'internal'`, no PO; done by tick + photo).
- `project_trade_tasks.fulfilment_kind` ('po'|'internal'); production orders are a later module, do not build.
- Board shows derived Furniture condition / Reno item condition / Reno condition / Payment condition / Unit key (see contract).
- Cross-project calendar page + `GET /api/renovation/calendar`, drag to reschedule (desktop), list by day on phone.
- Task labels follow the Notion vocabulary in the spec section 5.

## Open questions (defaults used unless the owner says otherwise)
1. Trade order: suggested only (owner, 9 Oct).
2. Instalment trigger: per template (stage start or stage done).
3. Site supervisor role: office role with Projects edit for now.
4. Owner/unit pick: copied text for now.
5. Hide Property OS "Finances" until phase 4: yes.
6. Shop drawings max 3 amendments: count only, no hard block.
