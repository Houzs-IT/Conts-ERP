# Open items

Live site: https://theconts-os.pages.dev (Supabase project cweomoenhsjvsxfsmiiw, schema `pos`, via Hyperdrive e0781ccd...). Staging preview: https://staging-preview.theconts-os.pages.dev (Supabase ecgyrmblqfxvbfjlqkdq).

## Next: connect Airbnb, Booking.com, Agoda through Channex
- Decision made: Channex (WhiteLabel plan, $130/month + $0.50 per unit per month, free staging at staging.channex.io; check current price at signup).
- Stages 1-4 are done, tested and merged to main; migrations `0003`-`0005` are applied on production too. Still inert in production — no `CHANNEX_API_KEY` set there yet.
- Stage 4 (messages and reviews) could not get a live end-to-end test: Channex's sandbox has no way to fake an inbound message or review (unlike bookings' "Booking CRS" tool), and the shared pool of test Booking.com hotel IDs stayed occupied throughout testing. Verified instead against real staging data with Channex's API calls stubbed — see PR #8. Worth a real look once an actual guest message/review comes in, or once stage 5 connects a real listing.
- Stage 5 built (feat/channex-stage5): CHANNEX_BASE_URL per environment (wrangler.toml), "Set up in Channex" on a unit creates its listing (apartment, MYR, one room, standard rate) and opens a year of dates; "Connect channels" opens Channex's channel screen for that unit. Tested on the sandbox: scripts/api-checks/channex-stage5.mjs.
- Channex reply (Evan, 30 Sep): the headless /channels iframe is deprecated; build connect and mapping on the Channel API. Certification = run the PMS certification tests on staging from the Conts UI, submit the form, then live verification (screenshare or recorded video of the ops lead using Conts; no code review, no developer needed).
- Certification build (feat/channex-cert): outbox queue (channexQueue.ts) with one call per property and kind, 10/min per property budget, 429/5xx backoff, quiet-period batching, full sync 500 days in two calls, min stay and stop sell per night (Calendar), Channex panel on Integrations with task ids. Tested on the sandbox: scripts/api-checks/channex-queue.mjs.
- Certification form submitted 30 Sep (task ids in the owner's notes); waiting for Channex's review and live verification. Keep staging unit T-01 ("Test Property - Conts") for it.
- Channel connect screens built (feat/channex-channel-connect): unit Channels card connects Booking.com / Agoda by Hotel ID (rooms and rates looked up, one picked) and Airbnb by sign-in link and listing pick (#/channex/airbnb-return). Full Booking.com connect not yet proven on the sandbox: all shared test hotels (5868189, 6519420, 4372137, 10484818) were held by other testers; ask support@channex.io to free one. Airbnb needs a real Airbnb account to test.
- Channex is live on production (2 Oct): certification passed, Whitelabel subscribed, production key and webhook secret set, booking notifications on. No real unit connected yet.
- Per-channel prices (feat/channex-per-channel-prices): each linked unit has four Channex rate plans (Direct, Airbnb, Booking.com, Agoda); one pricing rule in functions/_lib/channelPrice.ts (night's own price, else base + uplift, weekend x1.22; default uplift 12/18/16% of base) shared by Pricing, Calendar and Channex. Needs migration 0041 on production before merge.
- Production still holds the seeded example data (3 sample units, 5 owners, 5 bookings ...). Owner chose to clear it before real data: scripts/clear-example-data.mjs (listing by default; --apply --confirm=<ref>; keeps users, settings, integrations, automations, audit trail). Then enter the real owner, building and unit, and connect Airbnb first (Booking.com after; Agoda not used yet).
- Four seeded staff accounts exist on production (management@, finance@, aina@, nurul@theconts.com); owner to confirm whether they are used or switch them off.
- Scheduled worker theconts-cron (Channex outbox retry, email/WhatsApp retry, overdue sweep, 08:00 digest, repair-block release): published by the "Deploy scheduled jobs" workflow on merge or by hand (.github/workflows/deploy-cron.yml); needs repository secret CHANNEX_API_KEY (live key). Local check: node scripts/cron-dry-run.mjs.
- Watch: one listing must never be controlled by both the old connection and Channex; plan the import of existing bookings.

## Supply Chain as a copy of Houzs (decision: option B, resumed 7 Oct)
- Plan: copy Houzs's supply chain screens and server code into Conts, re-coloured gold and black, instead of re-drawing each screen. Rental side untouched. Houzs's code is on this machine at C:\dev\Houzs-ERP (reference only).
- Size: about 390 screen files and 167 server route files in Houzs against 29 simplified screens here; menus already carry the same names.
- Done: Houzs's `scm` structure as migration 0044 (248 tables, 22 views, 64 functions, 31 triggers, plus public.companies with one row, CONTS), built from read-only catalogue exports of live Houzs. Applied to staging only. Row level security on with no policies; pos_app and service_role granted.
- Known gaps in 0044: three functions name Houzs tables outside scm (mfg_product_category, positions, projects, project_event_types) and fail if called; Houzs's `authenticated` policies were not copied.
- Finding (7 Oct): the supply chain is not separable from the rest of Houzs (the sales order list alone pulls in 40% of the server code and 63% of the screen code), so the owner chose to run Houzs's code whole, alongside the rental app, with only supply chain switched on.
- Done: migration 0045 (rest of Houzs's structure in `public`, RLS on, nothing granted to anon), staging only. `engine/` holds the copy; it starts locally against staging, a test admin signs in, and the Sales Orders screen and the main supply chain lists load (empty).
- Done (7 Oct): engine on staging as worker `conts-scm-engine-staging` and Pages project `theconts-scm`; The Conts colours, name and provisional logo (engine/frontend/conts/palette.mjs swaps Houzs's palette at build time); menus trimmed to supply chain; migration 0046 (company identity, staging only).
- Done (7 Oct): supply chain menu items in Property OS open the engine's screens in a frame, signed in by the server (functions/api/supply-chain/engine-session.ts -> engine/backend/src/conts/sso.ts, HMAC with a shared secret). Used only where SCM_ENGINE_API, SCM_ENGINE_SITE and SCM_ENGINE_SSO_SECRET are all set; elsewhere the 29 built-in screens still show. Tested: scripts/api-checks/scm-engine.mjs.
- The engine worker is deployed by the owner (`npx wrangler deploy` in engine/backend); its secrets from engine/backend/.dev.vars with `wrangler secret bulk`.
- Done (7 Oct): quick-add button, assistant and profile menu hidden; Service cases and Projects added under Operations (owner's manager asked); migration 0047 gives the engine its own role, scm_engine, which owns the engine's tables and has nothing in `pos` (staging only; staging engine still connects as admin until its Hyperdrive is switched).
- Owner's manager approved production for supply chain, service cases and projects (7 Oct). Production needs, in order: migrations 0044-0047 on production; SCM_ENGINE_PASSWORD set through migrate-pg.mjs; `scm` exposed in the production Data API; a Hyperdrive for scm_engine; production worker, R2 bucket, KV namespace and secrets (new values, not staging's); production Pages build of the screens; SCM_ENGINE_* on the production Pages project; merge. No test admin on production: the first engine accounts arrive by sign-on from Property OS.
- End-to-end order on staging (7 Oct, through the owner's browser, test data marked TEST): warehouse, showroom, state-to-warehouse link, product, venue, supplier, sales order HC-SO-2610-004, RM 100 cash payment (balance 0, PAID), purchase order HC-PO-2610-001 from the sales orders, goods receipt HC-GRN-2610-001 (stock 2, value RM 120), delivery order HC-DO-2610-001 all saved with correct figures. Sales invoice not reached.
- OPEN, blocks production: saving a goods receipt and a delivery order writes everything within a second but the request never answers (worker log shows it Canceled after about 30s; the screen sits on "Saving..." / "Creating..."). Sales order and purchase order creates answer normally. Cause found (7 Oct): the Cloudflare account is on the free Workers plan, which allows 50 outside calls per request; one delivery order makes 83 to the database's REST API. Calls past 50 fail, each is retried for 2.4s (engine/backend/src/db/supabase.ts), and the after-steps swallow the failure, so the save answers 201 after 50-85s with the stock deduction missing (staging DOs 001, 003, 004 have no stock movement; the same request on the local engine takes 3-4s and writes one). Fix: Workers Paid plan (1,000 per request) on the Conts ERP account, owner's decision; then re-run the test and re-check stock. Do not go to production on the free plan.
- Found and fixed by that test: no system staff row (migration 0048).
- Found, not fixed: document numbers carry Houzs's prefix (HC-SO-, HC-PO-, HC-GRN-, HC-DO-); a new record does not show in its list until Refresh (list responses are cached for 60 seconds); the venue name box in Project Maintenance is squashed to a few pixels inside the frame; "Default warehouse" tick did not stick on the first warehouse.
- A new instance cannot raise an order until it has: Malaysian localities, a warehouse, a state-to-warehouse link (Sales Order Maintenance > Geo), a venue (Project Maintenance) or a salesperson parked under a showroom, and a product. Staging got Houzs's own starter reference data (engine/backend/scripts/scm-schema/seed-scm-reference-data.sql: 2,933 localities, 39 dropdown options, 7 categories, 4 sizes, 12 accounts, 46 fabric trackings) for the test; production still needs the owner's manager to choose copy or enter.
- Sales invoice step tested on the local engine (7 Oct): HC-SI-2610-001 from DO 005, RM 100, saved in 1.8s; revenue not posted to accounts ("group_unbound": item groups have no account linked yet).
- Before staff rely on it: fix the hang above; link item groups to accounts; engine permissions for operations staff; email, scanning, maps and AutoCount are off.
- Before production: a database role for the engine that cannot read schema `pos` (local testing uses the admin connection); reference data the screens need (dropdown options, categories, warehouses) entered or agreed with the owner.
- Open with the owner: does Conts use AutoCount; which Houzs modules Conts does not need (accounting ledger, consignment, HR commission, POS).

## Operations (Cleaning / Maintenance rework, feat/b1-ops)
- Migration 0090 (guest_left_at, task_checklist_items, maintenance category/urgency/source/assignee kind, maintenance_windows) must be applied on staging, then production, before this ships.
- A finished clean now charges its unit (cleaning expense, owner pays). While the owner workbook is still imported, a clean recorded in both could be charged twice if the workbook row is imported after the system clean; chargeClean skips a unit that already has a cleaning expense that day, the import does not check the other way.
- Demo walkthrough data: scripts/demo-ops-seed.mjs (--apply --confirm=<ref>, --remove); not run on staging or production yet.
- Done (feat/s3-history-notify): closing a repair job gives back its calendar block at once (cancelled if not started, ends today if under way), also for blocks made before migration 0095 (matched by the note); the scheduled job sweeps any left.
- Videos are capped at 50 MB per file (Workers request memory); longer clips need direct-to-R2 upload.
- Done (feat/cleaning-pod-audit, no migration): cleaning checklist removed from the board and the phone (owner, 11 Oct; its table and endpoint stay, unused); cleaner and type at the top of the job; board refreshes every 30 s so a clean finished on the phone shows as "Done HH:MM" without a reload; History in the Houzs ERP layout everywhere (one entry per action, coloured initials, "via Field app", changes folded); cleaning jobs now record their creation (checkout, prepare, plan) and show the checkout of the reservation they follow. Tested: scripts/api-checks/cleaning-pod-audit.mjs.
- Owner asked for several cleaners on one job (11 Oct, earlier list); one cleaner per job today. Needs a task_cleaners table (migration) and phone access for each cleaner; not built.
- Cleaning jobs imported from HostPlatform have no creation entry; their History starts with "Cleaning job created" from the job's own date.
- Done (fix/deep-clean-price-and-uploads): owner workbooks untracked and ignored (uploads/*.xlsx); copies kept outside the repo in C:/Users/User/Desktop/Conts-ERP-private. They stay in git history (private repo); purging history is a separate, owner-approved step. The plaintext logins on the workbook sheet 用户管理 must be changed by the owner.
- Done: a unit has a deep clean price (unit_expenses category cleaning_deep, unit Costs panel) that cleanPrice() charges for a deep clean. Tested: scripts/api-checks/deep-clean-price.mjs.
- Logo is blurry: public/brand art is 203 x 181 px cropped from a report and no larger file exists in the repo or the brand guide; needs the original logo file (AI, SVG or PNG at 1000 px+) from the owner.

## Maintenance rework (feat/maintenance-rework, 11 Oct 2026)
- Done (12 Oct): migration 0108 applied on staging and production.
- Guessed default: "collected from the owner" is ticked by hand (date picked); the owner statement already deducts the cost in the billing month, so for most owners the statement payout is the collection. Owner to confirm whether it should tick itself when that month's statement is paid.
- Guessed default: the quote is what the payer is charged; "owed to the technician or contractor" is entered separately (from their claim). No automatic markup between the two.
- Guessed default: a finished job's billing date can still be changed; its expense moves with it unless either month's owner statement is final.
- Guessed default: the technician list is every active technician, housekeeper and operations account (in-house) plus every contractor name used on a job before; a new contractor is typed once and then appears in the list. No separate contractor register (phone, bank details) yet.
- Finance admins have no Operations access by default, so contractor payments are recorded on Accounts payable > Contractor claims (feat/money-into-owners, POST /api/finance/payables writes contractor_paid_at). The amount owed is still entered on the maintenance job.
- Owners now see their own notices (bell on the owner portal); a quote sent for approval also emails them where mail is configured (MAIL_API_KEY), with a link that is a bare "/" rather than the portal address.
- scripts/api-checks/maintenance.mjs "unit with another open blocker stays off sale" fails on a fresh demo database: the demo data has no other open blocking job on #2207. Test-data issue, not code; fix the check's setup.
- No Who pays choice in the create form any more: a new job defaults to the owner paying, changed in the job's panel.
- No owner approval threshold any more (owner, 11 Oct): a quote goes to the owner only through "Send to owner for approval". The old setting operations.maintenanceApprovalThreshold may still be in the settings table and still saves through /api/settings; nothing reads it. Remove it from settings/index.ts when convenient.
- Parts catalog (the SKU list) is hidden from the Maintenance header until the owner sets it up: flip SHOW_CATALOG in src/pages/MaintenancePage.tsx; "Draw a part" still appears on a job only when stocked items exist.
- Photos of the problem picked in Add maintenance job and Report damage go up after the job is saved, as Before photos; a failed photo is named in a warning and does not undo the job. A cleaner may add photos to a job they reported. Report damage with photos was checked through the API only (no clean on the demo board to open it in the browser).

## Money moved into owners (feat/money-into-owners, 11 Oct 2026)
- Owner statements and Owner payouts are off the menu: one owner's month is on the owner's page (mark final, send, mark paid, add adjustment, payout list); every owner's month is the Owners list's Statements and Payouts tabs (Finance area only). #/finance/statements, #/finance/statements/:id, #/finance/payouts and #/finance/expenses redirect; #/finance/statements/:id/report (the printed report, owner portal PDF) is unchanged.
- Expenses is now Accounts payable (#/finance/payables): Bills (the expenses list, unchanged) and Contractor claims (maintenance jobs' amount owed, paid or not). Bills entered as expenses have no paid date; tracking paid / not paid for utilities and cleaning vendors needs a new column (expenses.paid_at). Owner to decide whether finance needs it.
- Owner question: Guest documents (guest invoices and receipts) is guest invoicing, not part of the unit contract; its menu entry moved under Reservations, page and address unchanged. Owner to confirm that is where it belongs.
- The FINANCE menu group (Accounts payable, Approvals) is left off the phone menu for every staff role; the screens still open by link. The Owners list's Statements and Payouts tabs show on a phone only when a link opened one.
- "Accounts payable" is not yet in docs/VOCABULARY.md as a decided word; the owner used "AP" (11 Oct).

## Field app on the phone: technicians and cleaners (feat/mobile-field, 11 Oct 2026)
- No technician account exists on staging or production: create one per technician (Users and roles, role Technician) before they can sign in. Local demo has Hafiz Rahman (scripts/local-demo-setup.mjs).
- Technician cannot enter the amount owed for a claim: the money fields stay operations manager, finance and management only (existing rule). They upload the claim file; the office types the amount. Owner to decide whether technicians should type it.
- Technician notes live in the job's History (audit_log, action maintenance.note), no notes column. If notes need editing or deleting, add a table.
- A technician cannot give back a picked job on the phone; the office reassigns it. Add "Release job" if the owner wants it.
- Only role technician may pick up jobs; a cleaner given a repair works it on the phone but cannot pick up open ones. Operations staff who repair use the desk screen.
- Access instructions are free text, and some demo instructions contain the door code (e.g. "Smart lock 9021#"); the field app shows the instruction, never the stored code. Owner to check real instructions do not carry codes he wants hidden.
- Office phone controls: buttons and inputs are 44px on touch screens under 768px (tokens.css), OpsModal is full screen on phones. Only Maintenance and Cleaning were checked at 390px; other office pages get the same sizes untested.
- scripts/api-checks/maintenance.mjs "field tasks" can fail on a random uuid containing "fee" (the check greps the JSON for revenue|fee|payout). Test issue; match keys instead.
- scripts/api-checks/maintenance-billing.mjs "operations staff cannot record money" fails locally: the demo data has no operations staff user (11111111-...-000000000004). Seed one.
- Next (owner priority 3): owner portal on the phone. Seen at 390px: no horizontal scroll, but Unit health lists every job ever (dozens on a busy unit, no grouping or "show more"), the header cuts the owner's name ("Lim Chee ..."), the Documents list is one long column of statements (no year grouping).
- Next (owner priority 4): management read-only on the phone. Seen at 390px: Dashboard, Operations Today and Bookings fit with no horizontal scroll; not checked for every desktop field being visible on the phone cards.

## Performance (audit 11 Oct 2026, docs/audits/performance-from-sister-erps.md)
- Owner decision: Workers Paid on the Conts ERP account. On the free plan, Send statements makes one email call per owner (~100 a month) against 50 outside calls per request; calls past 50 fail and are not retried while the cron is off. Until then send 40 at a time.
- Done (feat/calendar-bulk): a bulk price change goes a few units per request (6,000 price rows at most; the server refuses over 20,000 with 413), so a year for all 139 units is about 25 requests in a row; the time per request on Cloudflare's free plan is UNTESTED.
- Confirm the Hyperdrive origin is Supabase's session pooler (port 5432), not the transaction pooler.
- libphonenumber (149 KB) is in the entry script because src/lib/format.ts formats phones; lazy-load it if the entry budget (scripts/checks/entry-bundle.mjs, 180 KB gzipped) gets tight.

## Renovation project screens (feat/reno-project-ux, migration 0111, 14 Oct 2026)
- Done (14 Oct): migration 0111 applied on staging and production (lead); PR #245 merged. It adds project_attendees (backfilled from sales_person_id / designer_person_id), project_procurement_dates, project_design_notes and two columns on project_design_files. The engine deploys on merge, so the migration must be on production first.
- Done (14 Oct, owner ruling): renovation projects show on the original Calendar (desktop and phone) from created date to planned handover; else actual handover, else SLA due date (project_types.sla_days, not a column yet), else 45 days marked "end estimated". Computed when read (services/renovation/calendarSpan.ts). The old Task calendar is no longer reachable from any menu.
- Later: procurement dates (Procurement details) are meant to raise purchase orders automatically; nothing does yet (TODO(auto-PO) in engine/backend/src/services/renovation/procurement.ts).
- The create form still asks for Sales and Designer; both become Attending. Wiring it to Project PIC / Attending waits for feat/reno-customer-info (migration 0112).

## Renovation Project List and Calendar week (feat/reno-list-calendar, no migration, 15 Oct 2026)
- Done: the Project List in renovation mode shows step tiles (projects per step, click to filter, ?step=) instead of Live now / Upcoming / Overdue tasks; each card / table row shows name, customer, Project PIC, the 6-step track, planned handover and Late / At risk (handover within 14 days before Handover); a step opens the project at its section (#reno-design, #reno-contract, #reno-procurement, #reno-unit-key). Hide completed = hide the Closed step; the date filter matches created date to planned handover. The checklist "Task" filter is hidden in renovation mode.
- Done: Calendar Week view in renovation mode shows dated items per day (onsite, 3D / 2D submissions, PO and delivery dates, site tasks, planned handover) instead of project bars (GET /api/projects/calendar/events?items=1). Month view keeps the bars. Exhibition mode unchanged.
- Owner to confirm: "At risk" window of 14 days (AT_RISK_DAYS in engine/frontend/src/pages/projects/renovation/renovationListModel.ts).

## Renovation project screens, round 2 (feat/reno-project-ux-2, migration 0114, 14 Oct 2026)
- OPEN, before merge: apply migration 0114 on staging, then production (lead). It adds several PICs per Onsite entry and per design version, Onsite photos / files, and closes 2D amendment requests by the version that answers them (existing 2D notes are closed by the next 2D version after them).
- Person pickers still read project_people through PersonSelect; feat/people-from-users switches them to user accounts. The position after a name comes from personPosition() in PersonSelect.tsx (roles today).
- Customer info block on the right column waits for feat/reno-customer-info (migration 0112).

## QA sweep (fix/qa-sweep, 15 Oct 2026, docs/qa/2026-10-15-qa-sweep.md)
- Decided (owner, 15 Oct): leave as is. Dashboard "12 months" strip keeps adding every owner statement beside the reservation-only guest total (finding 6).
- Decided (owner, 15 Oct): leave as is. Create reservation keeps filing a matching phone under the existing guest (finding 7).
- Done (fix/engine-polish): Fit-out register and Guest documents screens retired (owner, 14 Oct); their addresses show "This page does not exist". Their server endpoints and data stay; guest invoices and receipts are still issued from a reservation (finding 8).
- Done (fix/engine-polish): engine table messages stay in the visible part of wide tables; list summary cards say "Couldn't load" with Retry; inside Property OS the engine draws no top bar of its own (tab strip, search, refresh, bell) and the phone Calendar has no second search; Settings drops the AutoCount Sync tab and its /api/sync/status call; the phone project list has New project (findings 12-16). Renovation PO: a line of another category is named before Save, and the database refusal shows inline. Phone Calendar Week in renovation mode lists dated items like the desktop.
- Supply chain data screens could not be checked locally (engine reads through Supabase REST); check them on the staging preview (finding 17).

## Later
- Packages (8 Oct, chore/update-packages): Property OS has 0 flagged packages (wrangler 4.148, source-map-js, and an override pinning sharp to 0.35.5 inside wrangler's local emulator; all build/dev tools, none ran in production). Engine: the non-breaking fixes are in (hono on the server, dompurify on the screens, and build tools). Left in engine/, each needing a breaking upgrade of Houzs's code or tools: react-router 6 (moderate), wrangler's sharp and undici, esbuild, vitest, braces. Take them with the next Houzs copy.
- Email delivery: needs MAIL_API_KEY on the preview environment too; production has it.
- In-app notifications and record History (feat/s3-history-notify, migration 0095): staff are told inside the app only; email copies go out only where MAIL_API_KEY is set. Payout and expense rows imported from the owner workbook have no History before 10 Oct 2026 (the import never wrote audit rows).
- Remove leftovers from the old Cloudflare database (scripts/d1-source.toml, D1 setup scripts) once the old D1 is retired.

## Future (planning only, not started): guests pay online for direct bookings
- Only direct bookings need it. Airbnb, Booking.com and Agoda collect the guest's money themselves.
- Flow: reservation -> "Send payment link" (WhatsApp/email) -> guest pays on the gateway's own page -> gateway calls our webhook -> reservation marked paid -> amount feeds the owner statement. Refunds and failures show on the reservation. Card numbers never touch our system.
- Gateway candidates for Malaysia (compare fees and sign-up rules at the time): Billplz or Toyyibpay (FPX, simple), HitPay (FPX, DuitNow QR, cards), Stripe (best tooling and foreign cards, more setup for local banks). Leaning Billplz or HitPay for mostly local guests.
- Decisions needed first: deposit vs full payment vs damage deposit; local vs foreign guests; which company account and documents the gateway needs.
- Build order when the time comes: payment link + webhook + paid status -> refunds -> deposits -> optional guest booking page.
- Owner payouts stay separate (bank transfers from the Payouts screen); the gateway only collects.

## Future (planning only, not started): Anthropic API key
- Not needed for development help. Only needed for the two items below.
- AI inside the system: suggested replies to guest messages (start here, so the value can be judged first), draft replies to reviews, plain-language summary of each owner statement, daily "what needs attention" summary. The server calls Claude with the key stored as a Cloudflare secret (`wrangler pages secret put ANTHROPIC_API_KEY`), never in the browser. Pay per use.
- Optional: automatic Claude review of every pull request on GitHub (key stored as a GitHub Actions secret).
- Do after Channex, when there are real bookings and messages to work with. Key never pasted in chat.

## Future (planning only, not started): security hardening
Suggested order. Items 1-3 together are about 2 days and close the biggest gaps.
1. Done (feat/s5-security-backup): two-step sign-in, sign-in record, sign out everywhere / other devices, My account. See "Security and backups" below.
2. Login protection through Cloudflare: Turnstile on the login page, rate limiting on login, password reset and other sensitive endpoints. Check which Cloudflare plan includes each feature.
3. Alerts: email management on a login from a new device, repeated failed logins, or a bank-detail change.
5. Restrict the staff sign-in to office addresses or put it behind Cloudflare Access (needs office network details).
6. Data safety: nightly encrypted backup with a tested restore is built (see below); Supabase point-in-time recovery (paid add-on) and limits on bulk exports still open.
- To discuss later: what "bandwidth" should mean here (blocking floods of requests = item 2, or limiting how much data one user can download = item 6).

## Security and backups (feat/s5-security-backup)
- Production order: apply migration 0055, then 0098, then deploy. The code checks for both columns, so a deploy that lands first does not lock anyone out; sign out everywhere and two-step sign-in answer "needs a database update" until they are applied.
- Owner: add a Pages secret TOTP_ENC_KEY (32+ random characters) on production and on preview (`wrangler pages secret put TOTP_ENC_KEY`, with `--env preview` for staging). Without it two-step sign-in cannot be set up; changing it later makes every enrolled authenticator stop working (backup codes still work, management resets).
- Owner: add GitHub secrets PROD_DB_URL (Supabase session pooler string) and BACKUP_PASSPHRASE, then run Nightly database backup once by hand (docs/DR-RUNBOOK.md). Not yet run against production.
- Not in the nightly backup: the supply chain engine (scm, public Houzs tables) and photos/documents in R2.
- Requiring two-step sign-in per role is off for every role until management ticks roles in Settings > Security.
- login_events keeps every attempt with no pruning; add a retention job once the cron worker is deployed.

## System health
- System Health (feat/system-health): System > System health, laid out and shaped like the Hookka /admin/health page (banner, stat cards, audit feed with range and sensitive-only) so it can be moved between systems; `db`, `r2`, `counts` and the audit feed are the portable core, `checks` are Conts's own (email, Channex, booking notifications, sync queue, background jobs, problems). No migration. The separate Audit trail page is gone: the audit feed here opens each row to its before/after and pages up to 1000 events per range (/system/audit redirects; /api/audit stays for booking history). Tested: scripts/api-checks/system-health.mjs.
- Credit / debit notes is out of the menu (owner, 7 Oct: add back if asked). The screen and its route /accounting/credit-notes still exist; restore by adding the item to navigation.ts.

## Permissions
- Editable permissions (feat/role-permissions): Users and roles > Permissions is now a chart management edits, 21 areas x 3 roles (operations manager, operations staff, finance admin), levels none / view / edit / full, saved to pos.role_access (migrations 0049, 0050; staging only). An area with no row keeps the built-in rule, so an empty table changes nothing. functions/_lib/access.ts holds the areas; requireSession sets session.manage, which replaced 142 MASTER_ROLES / canSeeFinance checks; the middleware refuses writes below edit. Tested: scripts/api-checks/role-access.mjs (23).
- Done (fix/audit-rbac): the level the Permissions chart shows is the level enforced, built-in or chosen: No access refuses reads in every area (exports and search included), View refuses writes. Reads other screens share (unit list, cleaner names, record history, supply chain reference lists) and cross-screen actions are listed with reasons in ROUTE_AREAS (functions/_lib/access.ts). Housekeepers and technicians are deny-by-default like owners (FIELD_ALLOWED). File downloads check the file's record. Checked by scripts/api-checks/rbac-matrix.mjs (361 route-methods x 8 roles + 40 scenarios) and the require-permission gate in npm run check; catalogue docs/audits/rbac-from-sister-erps.md.
- Owner to decide: management can make a password reset link for another management account (Users > Reset link), which is a way into that account; limit reset links to non-management accounts?
- Open: some handlers look a record up before checking the role, so a desk role can tell that a record id exists (404 vs 403); ids are random, low risk.
- Permissions inside the supply chain engine (7 Oct): the sign-on carries the role's level for the 8 engine areas (functions/_lib/scmEngine.ts); the engine turns them into its page access and permission keys per role "Conts: <role>" (engine/backend/src/conts/access.ts, sso.ts) and one hook in Houzs's services/auth.ts (hydrateAuthUser) applies them. Full in all 8 keeps the full-access role. Standard for operations staff: edit in supply chain and service cases, view on projects, no invoices or accounting. Tested on the local engine: scripts/api-checks/scm-engine-access.mjs (17). Needs the engine worker redeployed (owner). Known: Houzs lets a role with Sales order view read sales invoices (read-inherit); raising one is refused. Test accounts chart-*@theconts.test were created on staging by the check.
- Permissions (8 Oct): the 20 handlers with their own role lists (guests, housekeeping, inventory, maintenance SKUs, channel sync, owners, contracts, reviews, unit readiness, automations, integrations, access codes) follow a chosen level through mayWork / maySee / mayRun in functions/_lib/access.ts. Inviting users, organisation settings and the audit endpoint stay fixed to their roles on purpose (a role that could invite users could make itself management).
- Permissions, not done: per-person exceptions (owner, 8 Oct: later); production migrations 0049-0050 and the merge, after the owner approves staging.

## Staging tools
- View as (feat/view-as, stacked on feat/role-permissions): on staging only, a management account switches to any active account from the "View as" button (bottom right) and back, without signing out. functions/api/auth/view-as.ts; off unless VIEW_AS = "staging" (preview vars in wrangler.toml only), the address is not erp./ops./owner., and the person who really signed in (signed tc_origin cookie) is management. Each switch is audited as user.view_as. Tested: scripts/api-checks/view-as.mjs (off: 3, on: 11). Never add VIEW_AS to the production [vars].

## Supply chain engine: screen-by-screen test (8 Oct, staging, owner's browser)
- All 41 menu screens open with no failed request (local engine against staging data).
- Saved for real on staging: stock adjustment, stock transfer HC-ST-2610-001, stock take HC-STK-2610-001 (counted and posted), service case ASSR/2610-001, consignment order HC-CS-2610-001.
- Delivery return from a DO: the save froze for 30s on staging then reported "already being processed": the free-plan 50-call limit again (third save type after delivery orders and goods receipts). Re-test after the plan upgrade.
- Fixed (fix/engine-project-create): nobody at Conts could create a project, Houzs's rule names its own staff (BD role, Owner title, one email). Now Full on Projects in the Permissions chart may create (engine/backend/src/routes/projects.ts, engine/frontend/src/auth/salesAccess.ts). Needs the engine worker and screens redeployed.
- Projects cannot be created until Project Maintenance has at least a Brand and an Event Type (both lists are empty on staging; the Create button stays disabled). Done (fix/engine-left): editing a project's schedule reference now needs projects.manage (Roles), not the BD role or one Houzs email.
- Not yet saved for real: sales order amendment, PO amendment, cancellation request, purchase invoice, purchase return, consignment note and return, the three purchase consignment screens, delivery planning and trips, racks, a project.

## Airbnb live test (8 Oct, production, test host account)
- Works end to end on the pilot unit: prices and open dates reach Airbnb; a real booking (17-18 Nov) arrived confirmed with dates, 3 guests and the guest record. A booking only arrives once Airbnb confirms it (a guest stuck on ID verification stays pending).
- Fixed (fix/airbnb-booking-amounts): Channex's amount on Airbnb is the host payout (104.07 for a RM 125 night); the booking value is now payout + fee and the fee is stored in reservations.channel_fee (functions/_lib/channexAmounts.ts, scripts/api-checks/channex-amounts.mjs). Assumes the revision carries the note text as `notes` and/or `ota_commission`; confirm on the next real booking (audit row channex.booking_created now records grossSen, feeSen, amountSource). The first booking keeps 104.07 unless a new revision for it arrives.
- Fixed (fix/airbnb-cancel-reopens): after both test bookings were cancelled on Airbnb, Conts showed the nights free but Airbnb kept 17 and 18 Nov blocked: a booking or cancellation arriving from Channex never queued availability, and the webhook has no session so nothing flushed the queue. channexBookingSync now closes the nights on a new booking, reopens them on a cancellation (unless another stay holds them) and moves them on a date change; the webhook flushes the queue. Not exercised against Channex yet: confirm with the next live cancellation.
- Done (feat/airbnb-followups): a 403 from Channex on messages or reviews is no longer audited (the "Channex Messages & Reviews" app is not installed on the account: Applications > Available; installing it is the owner's call); connecting a booking site marks the unit listed, and migration 0051 marks the ones already connected (staging applied).
- SUPERSEDED by the workbook rules (feat/owner-statements, below): owner statements (functions/api/statements/generate.ts) count only reservations with collected_revenue > 0, and nothing in the system ever sets collected_revenue, so no real booking reaches a statement. Decide: what counts as collected (booking-site bookings on arrival / at check-out; direct bookings when paid), whether the management fee is taken on the sale price or on what is left after the booking site's fee, and who bears the booking site's fee (reservations.channel_fee now holds it for Airbnb).
- SUPERSEDED by feat/owner-statements (it now pays RM 2,444.93): statement check against the workbook (8 Oct, feat/scale-finance, one unit-month: Agile C37-13A, Aug 2026, profit share 75/20/5): workbook owner payout RM 2,444.93, our provisional statement RM 3,455.48 (RM 1,010.55 more). Same bookings and bills underneath (revenue prorated to August nights is RM 5,342.70 in both). Differences: (1) we count a stay wholly in its check-in month (RM 6,566.59), the workbook splits it by night; (2) we take 25% of gross as the fee and charge every cost to the owner, the workbook splits profit after costs (owner 75%, management 20%, agent 5%); (3) the workbook's minimum guarantee (pay the larger of the share or the fixed amount, "LT") is not modelled; (4) 杂费扣款 lines (O2, -RM 401.94 here) and a RM 77.42 prorated miscellaneous charge are not imported. Decide before any statement is sent.
- SUPERSEDED by feat/owner-statements: statement rules found in code: generate.ts takes the highest fee among an owner's contracts (ignores the unit's own fee and the owner default the Owners screen uses); a guaranteed-rent (GRR) owner is paid gross minus costs instead of the fixed rent; regenerating a provisional statement drops its manual adjustment lines (adjustments_total keeps the old figure).

## Supply chain engine on production (8 Oct, owner's decision: go live now on the free Workers plan)
- Steps live in scripts/engine-production.mjs (prepare, storage, secrets, deploy, seed, screens, switch-on); production settings in engine/backend/wrangler.production.toml. The engine connects as scm_engine, not the database admin (checked on staging data: access checks, a sales order and a delivery order). Property OS uses the engine on live only once wrangler.toml names it (SCM_ENGINE_API, SCM_ENGINE_SITE in [vars]) and the sign-on secret is stored: that change is its own pull request, merged last.
- Known on the free plan: delivery orders, goods receipts and delivery returns exceed 50 calls per request, answer slowly and can skip the stock deduction. Upgrade to Workers Paid on the Conts ERP account to clear it; nothing else changes.
- After go-live: enter a Brand and an Event Type before creating projects; confirm company details and logo; the starter lists are Houzs's (furniture categories).

## HostPlatform import (feat/hostplatform-seed, /system/integrations/hostplatform)
- Not run on staging or production yet. Run order: listing, workbook units, reservations, workbook Airbnb earnings, cleaning, utilities. Safe to repeat until cutover. Proven twice on PGlite with the real files: scripts/api-checks/hostplatform-import.mjs <data folder> (files stay outside the repo).
- UNTESTED on Cloudflare: CPU time per request. Mapping 200 bookings takes about 4 ms locally; if a step fails with "exceeded resource limits", lower CHUNK in HostPlatformImportPage.tsx.
- Money that reaches owner statements: imported bookings set collected_revenue (HostPlatform "Payment Received"; the workbook's Airbnb payout where it has one) and the workbook adds cleaning and utility expenses. Check one owner's statement against the workbook before sending any (see the open collected_revenue decision above).
- Done (fix/channex-collected-revenue-2): a booking arriving through Channex records its payout (booking value less the site fee) as collected_revenue, so it reaches the owner statement; before this it counted RM 0. Tested: scripts/api-checks/channex-collected-revenue.mjs. Live had only 2 cancelled Channex bookings, so nothing to backfill there.
- feat/data-complete (migration 0052): Package D, contract agent share / Package D minimum / agreement file / misc-charges flag, 329 utility accounts, 5 debts (held), 306 guarantee-pool months, 3 cleaners linked to 4,024 cleans, 187 workbook credits as owner_adjustments, OWNER PAYOUT history as paid statements Jan-Aug 2026 (step 7), booking money breakdown columns, building state/city clean-up (step 8). Production needs `node scripts/migrate-pg.mjs --prompt --dry-run`, then `--prompt`, then import steps 2-8 again.
- Not imported, no data or no home: HostPlatform weekend price (equal to weekday on all 114), per-booking cleaning cost, SALES ORDER and STAMPING (blank on every unit), agent names (not in the workbook), water account numbers (no column in the workbook), 整体报告 for months other than Aug 2026 (the sheet holds one month).
- Owner to decide: when the 5 held debts (RM 38,341.88) are deducted. Owner page > Expenses by unit > Paid on behalf (or the unit's Financials tab) releases one into a chosen statement month (also Hold, Settle outside; management, finance, operations manager); new amounts are entered as bills paid on behalf. A released debt larger than the month's payout makes the payout negative (RM 14,000 debt on a RM 4,630 month gave -RM 9,369.70): decide whether to deduct it in full or spread it over months. Check: scripts/api-checks/owner-adjustments.mjs.
- Owner to decide: September 2026 has no OWNER PAYOUT figures, so it is the first month Property OS generates; Jan-Aug are locked as paid workbook history.
- 3 credits (RM 339.04) on SKYLINE-C1513 wait for that unit's owner to be named; re-run step 6 after.
- No screen yet shows unit utility accounts or guarantee pool months (owner adjustments now show under Paid on behalf on the unit and owner pages).
- Owner ids no longer carry IC numbers: 0052 re-keys 'wb-owner-<IC>' / 'hp-owner-<name>' to opaque hashes (checked by scripts/api-checks/owner-rekey.mjs). Guest ids are an unsalted 64-bit hash of name, phone and email: not readable, but a phone number could be guessed back from one; re-key with a secret if that matters.
- Owner to check: 7 units still under "Owner to be confirmed"; the listing names owner "sad asd" on 2 units (looks like test data); 'Trion KL (2)' came in as its own building next to 'Trion KL'; 1 Airbnb stay (UNO-1503A, 31 Aug) appears under two codes in the workbook and so twice on the calendar.

## Owner statements by the workbook's rules (feat/owner-statements, migration 0054)
- Generation (functions/_lib/ownerStatement.ts) follows the workbook: stays split by night, deductions, OWNER% split or fixed rent, Package D minimum, then O2 adjustments. Check: scripts/api-checks/owner-statements-workbook.mjs (needs the --serve database). Report: #/finance/statements/:id/report (Download PDF = print). Revenue metrics: functions/_lib/revenue.ts.
- Owner to decide: 379 HostPlatform stays (typed in by hand, no booking-site code) have no payout, so they count as nights but RM 0 income; the statement screen lists them under "Check before finalising". Decide where their income comes from.
- Owner to decide: rounding. The report multiplies the printed net income (2,647.45 x 85% = 2,250.33, as on his sample); his workbook multiplies the unrounded figure, which differs by 1 sen on 3 of 112 August units.
- Owner to decide: the guarantee pool (水池) balance rule could not be read from the workbook (values only, no formulas); generation records surplus into / shortfall out of the pool and the company top-up, and leaves the workbook's own months untouched.
- Owner to decide: a long-term (fixed rent) owner's report shows the rent and O2 lines only, not the unit's income and costs.
- 3 units have no contract and no split ("default" 25% operator share): give them a split or contract before sending.
- The workbook file has no bookings before March 2026 and no September cleaning, Wi-Fi or additional-deduction rows: those months/lines come out short until the data is entered; the year-to-date page shows Jan-Mar as the paid workbook payout (marked *).
- Owner portal: Download statement opens the Owner Income Report (pdf.ts redirects any statement with unit figures; months paid before Property OS keep the old print page; ?format=legacy forces it). Logo files are built from public/brand/the-conts-logo.png by scripts/brand/make-logo-variants.py.

## Units, Calendar, Dashboard at real size (feat/scale-units-calendar)
- Owner to check: building states are written three ways (13 "W.P Kuala Lumpur", 1 "WP", 6 blank), so the Units tree shows three groups for one state. Fix on each building (Units, pencil on the building).
- DONE (fix/revenue-metrics: gross booking value split by night, functions/_lib/revenue.ts): ADR on Dashboard and Portfolio was collected revenue over booked nights; bookings later this month count their nights before their money is collected, so the month-to-date ADR reads low (RM 70 against RM 112-187 per unit on the import). Decide: gross booking value instead, or count only nights already stayed.
- Calendar rate rows for all 139 units are about 20,000 cells (0.6 s to draw); they start hidden above 8 units. If people want them on for the whole board, virtualise the rows.

## UI audit follow-ups: shell, system and growth pages (fix/system-growth)
- Automations: 9 of 30 rules are sent by code today; the other 21 (every guest message) need a sender in the cron worker (theconts-cron, not deployed) plus email/WhatsApp keys. The page says so; the on/off switch is stored only. Owner decision: build the sender.
- Imported owner ids embed the IC number (e.g. wb-owner-940413-13-6097, functions/_lib/hostplatformImport*), so it shows in URLs and the audit log. Data agent to switch to opaque ids.
- Pricing: channel commission (15/15/18%) and the 22% weekend uplift are fixed in code; owner to decide whether they become settings.

## Booking lifecycle (fix/booking-lifecycle)
- Status moves are one map in functions/_lib/bookingLifecycle.ts, enforced on PATCH and cancel; drawer menu built from it. Check: scripts/api-checks/booking-lifecycle.mjs.
- Owner to confirm: no-show allowed from the check-in day (audit said "after"); undo check-in / check-out only on the same day and only for management; reinstating a cancelled stay is management only.
- Booking drawer money lines from migration 0052 (room, cleaning paid by guest, SST, tourism tax, payout, payout date ...) show automatically once 0052 is applied and filled; nothing is estimated before that.
- Not built: guest notification on cancel / date change (the screens now say the guest is not messaged); refunds; repricing rule for date changes (direct bookings take a new total by hand).

## Revenue metrics (fix/revenue-metrics)
- Dashboard, trend, portfolio, analytics and the unit header use functions/_lib/revenue.ts: gross booking value and nights split by night into each month; occupancy = booked nights / nights available on listed units. Management fees and owner payout on the dashboard stay RM 0 until statements exist for the month (generation by the workbook rules is in feat/owner-statements, which needs migrations 0052/0054).
- Done (fix/engine-left): engine backend light suite green (938 files). 15 files that need Houzs-only data, docs or CI are excluded in engine/backend/vitest.light.config.mts with the missing input named; 9 files skip only their few tests that read such inputs.

## Renovation (catalog, sales documents, project; 9-10 Oct)
- Production database has migrations 0060-0082 (10 Oct, Supabase connector, each with its pos_migrations row). The production engine worker and screens still run the pre-renovation code until redeployed: `node scripts/engine-production.mjs deploy` then `screens`, on the machine holding C:/dev/Conts-ERP-deploy and logged in to the Conts ERP Cloudflare account. Staging engine: `npx wrangler deploy` in engine/backend plus its screens build, same account.
- Owner: link item groups WORKS, BUILTIN, FURNITURE, LIGHTING, APPLIANCE, SOFT, SERVICE and RENOVATION to sales and sales-return accounts (Accounting > Item Groups), or invoices for those lines post nothing and negative instalments refuse their credit note; upload the Dream Crafter and The Conts logos (Project Maintenance > Brands).
- Owner questions, contract defaults in use: typed amount allowed when it differs from measure x rate (flagged *); rounding per line to the sen; QT-YYMM-NNN; PO split 30/65/5; credit note to the sales-return account; supply-by-owner goods get no PO; promotion column = unit price.
- Observed on a local engine (10 Oct, scratch Postgres + PostgREST): SKU photo upload, site receipts, the whole project flow (scripts/api-checks/renovation-project.mjs all passed, scripts/demo seed + cleanup). Not observed: revenue and credit-note journals (the local database has no chart of accounts), the PO payment-schedule card.
- Demo data for the live site: scripts/demo (seed + cleanup, browser snippet or terminal). Cleanup archives and cancels; billed contracts, cancelled documents and inactive DEMO SKUs/suppliers stay.
- Site receipt POST goes through the REST goods-receipt core and counts toward the free plan's 50 outside calls per request. Done (fix/engine-left): `npm run lint` in engine/ runs (Houzs's lint-ratchet.mjs and lint rules copied). Frontend is a gate and passes; backend is advisory as in Houzs's own CI: 334 file/rule pairs over Houzs's inherited ceilings, 27 of those files touched by Conts (renovation code), not fixed yet.

## Owners and revenue models (batch 4, 10 Oct)
- Migration 0093 (revenue_model, contract history, receipts, Indah Water category) is not applied to staging or production yet; apply after the PR merges, dry-run first.
- Long-term let units still show on the calendar and stay on channels: hiding them is the calendar's job (batch 3), not done here.
- The sidebar still says "Adjustments" where it means owner credits and charges, if anywhere: navigation belongs to batch 1.
- Expense receipt upload: clicked through in a browser on 11 Oct (fix/sweep-money-system): Record expense with a PNG receipt, then the Receipt link downloads the same file.
- 26 units with no contract record still run on their own split (units.split_kind); saving their Contract tab creates the contract.
## Calendar and rates (b3, 10 Oct)
- Migration 0092 (units.weekend_rate, reservations.block_reason) is not yet applied to staging or production. It backfills weekend_rate = round(base_rate x 1.22) for every priced unit so live Fri/Sat prices do not move; units created later sell the weekend at the base rate until a weekend rate is set (Pricing page).
- Channex full sync (functions/_lib/channexQueue.ts) still counts inquiries as taken nights; the board and the clash check do not. Decide whether an inquiry should close the nights on the booking sites.
- Rate update lists the units on the board, so with one building filtered it offers only that building; open it with All buildings to price across buildings.
- Done (feat/calendar-bulk): tick units on the board (per unit, per building, all shown) and Change prices sets a nightly and optional Fri/Sat price, min nights or blocked nights for a date range, per channel; step 4 shows each unit's price now and after (server dry run) before saving; one audit entry per request (rate.bulk, entity bulk:<batch>, old and new per unit). Phones keep the unit list inside Update prices instead of ticks.
- The unit column's Nightly / Weekend lines show the unit's standard prices, not prices set for single nights; after a bulk change the nights show the new price but the column does not. Decide whether it should say "from RM x" for the window.
- Calendar views: 1 week, 2 weeks, 30 days, calendar month, 60 and 90 days (the API allows 92); arrows step a whole window (a month in Month view). No year jump in the date picker; going back a year is 12 clicks in Month view.
- POST /api/blocks hangs on the local PGlite database (single connection) and then blocks every later request until the server restarts; calendar-rates.mjs stops at its owner-stay step there. Not seen on Postgres; check with a real local Postgres.

## Money approvals and guest documents (feat/s4-money-docs, migrations 0096-0097)
- Migrations 0096 (approval_requests) and 0097 (document_counters, issued_documents) must be applied on production before this ships; until then refunds, payout runs, owner credits and charges, large expenses and write-offs answer with a database error.
- Approvals switched off by default (owner, 11 Oct 2026: "the whole approval step is not needed"; fix/approvals-off): money actions apply at once. Settings > Approvals has one switch to bring them back; the limits (RM 500 / RM 2,000 placeholders) only matter when it is on. Production had 0 approval requests on 11 Oct.
- Done (feat/s3-history-notify): approvers get a bell notice when a request is waiting, the requester when it is decided, and finance when a payout run is approved.
- Expenses written by the system (finished cleans, utility bills from Record utilities, the workbook import) are not staged for approval; only expenses typed in on Expenses or an owner's page are.
- Guest documents are print-ready pages (Save as PDF from the browser), not PDF files; same as owner statements.
- Numbering under real concurrency is enforced by the database (counter row lock and one-live-document indexes); the local PGlite copy serves one connection at a time, so the parallel test there proves distinct consecutive numbers but not the index race. Re-run approvals-documents.mjs against staging Postgres before relying on it.

## Tables (stream 2, 10 Oct)
- Migration 0094 (pos.table_layouts, saved table views) is not applied to staging or production yet; apply after the PR merges, dry-run first.
- Lists that stay outside the shared DataTable on purpose: Expenses Grouped view (category tree loaded on demand), Payouts' grouped section headers (now one list ordered by attention), Reviews (reply cards), Automations, Integrations, Settings, Operations today, unit tree.
- DataTable has no expandable or grouped rows and no export header note; a page-computed total does not follow the table's own column filters (Owners turns column filters off for that reason).
- Cleaning bulk Start makes the person pressing it the assignee of an unassigned clean (existing start endpoint behaviour).

## Standards (docs/UI-STANDARDS.md, checked by npm run check and CI)
- Done (s1-standards): one status vocabulary (src/lib/status.ts) and StatusBadge / StatusMenu everywhere; text-success / text-danger now render the text colour; ConfirmDialog for every confirm; dates, money, counts and phones through lib/format; plain-English API errors; no Change dates on OTA bookings.
- Done: the 32 one-click Delete / Cancel buttons on the built-in supply chain screens now ask first (ConfirmButton).
- Open: make the CI workflow (.github/workflows/ci.yml) a required check on main (GitHub > Settings > Branches; owner, needs admin).

## Form inputs (feat/s6-inputs)
- Done: every money, number, percent, phone, date and time field uses src/components/inputs (no raw type="number"/date/time left; `npm run check` enforces it). Endpoints behind them refuse bad values with a field-level 422 (functions/_lib/validate.ts; scripts/api-checks/input-validation.mjs).
- Open: native date/time pickers are kept on purpose (phone calendars work well); a typed-text date field is not built.

## Phones for every country (fix/fix-phone-intl)
- Done: phones read, format and validate for every country through libphonenumber (src/lib/phone.ts, shared by format.ts, PhoneInput and the server's checkPhone); PhoneInput has a searchable country picker (MY +60 by default). 3,417 of 3,417 local guest phones read in their country's grouping (scripts/api-checks/phone-shapes.mjs).
- Open: 3 stored guest phones are the right length but outside any known range (2 x +60 2..., 1 x +49), so they show ungrouped.

## Renovation project, simplified (feat/reno-simplify)
- Done: 6-step flow (derived from SO / PO / site tasks / handover / paid, manual move + follow data, IN DEFECT / ON HOLD flag), people master, key log, design records, SO <-> project in either order, Notion task categories, in-house crew on site tasks, board columns per the owner, source/source_ref on importable rows. Migrations 0083-0086 not yet applied to staging/production.
- People from user accounts (feat/people-from-users, migration 0113, not applied anywhere yet): pickers list active staff accounts as "Name · Position · Department"; site crew without a login (people not linked to an account, site crew role) stay pickable as site task crew only and are kept in Project Maintenance > Crew (no login). Owner's ruling 14 Oct: near-name pairs (Alex / ALEX GOH, JIA XIN / JIAXIN, Chai Mengkeat / MENG KEAT) stay unlinked. Owner to fill in Position and Department on each account after 0113 is applied.
- Done (owner, 11 Oct): the hardware gate no longer blocks anything (task start, stage start/complete, site receipt); it only raises the red flag "Works started before: <missing items>".
- Open: the SO page "Project" card and the quotation "No project yet" choice were not seen in a browser (the local engine has no Supabase REST for the SCM routes); check them on the staging preview.

## Project Monitor (feat/reno-monitor) - DROPPED from the menus 11 Oct 2026 (owner: the Schedule covers it)
- Menus (Property OS, engine desktop sidebar, phone Projects tabs) no longer show it; old /projects/monitor and ?view=monitor links open the Schedule. ProjectMonitor.tsx and GET /api/renovation/monitor are kept, unused; delete them if the owner does not ask for it back.
- Done: role tabs Sales / Design / Renovation / Admin / Boss with queue tiles, red-flag strip, person filter, board-column table (cards on a phone; on the phone app it is a tab of Projects), site calendar; GET /api/renovation/monitor (23 queries in the PGlite test). No migration.
- Owner to confirm: "payment behind" norm = received % by step (Signed 10, Ordering 40, Renovation 60, Handover 90) and "no SO" red flag after 14 days (PAYMENT_NORM_PCT, NO_SO_FLAG_DAYS in engine/backend/src/services/renovation/monitor.ts).
- Open: add an "SLA passed" red flag once the project SLA due date from feat/reno-settings-e2e is merged (read it defensively).
- Open: the Admin queue (money received, items not arrived) was not seen with data locally: the local database has no paid invoices; check it on staging after the Notion import.

## System bugs from Houzs / Hookka (fix/audit-system, docs/audits/system-from-sister-erps.md)
- Done: same nights cannot be booked twice at the same moment (unit lock); status and dates changes are compare-and-set; statement generation is one transaction per period; supply chain numbers retry on a clash; MYT dates everywhere (gate myt-dates); CSV formula guard (gate csv-formula); uploads that are not images, video or PDF download instead of opening; 300 / 10,000-character text limits on every write; bookings CSV import validates each row.
- Open: built-in supply chain create screens add a placeholder row before the save answers and keep it if the save fails; only matters if the engine is switched off.
- Open: field edits are last-write-wins (no version column); status and dates are already protected.

## Supply chain click sweep (fix/sweep-supply-chain, 11 Oct)
- Done: built-in supply chain screens wait for the server before saying "saved" and re-read the list (src/lib/persist.ts); document drawers load their lines from the record; tested by scripts/api-checks/supply-chain-sweep.mjs.
- Owner to decide: Customers, Drivers, Vehicles, 3PL, zones, rate cards, categories, fabrics, payment vouchers, accounting and credit notes have no menu entry since 25 Sep; add them back or leave reachable only by address.
- Owner to decide: item codes on orders, adjustments and stock takes are free text; should they have to exist in Products?
- Owner to decide: credit notes may exceed what the invoice still owes (receivables go negative); cap them or allow refunds owed.
- Owner to decide: credit notes and consignment notes both number CN-YYYY-NNNN.
- Owner to decide: line discounts on sales and purchase orders are not carried to delivery orders, goods receipts or invoices.
- Owner to decide: delivery schedule (DP orders, last mile) is not tied to delivery orders, and does not warn about drivers on leave.
- Owner to decide: sales-order payments and sales-invoice receipts are recorded separately and can count the same money twice.

## Open from the money-and-system sweep (fix/sweep-money-system, 11 Oct 2026)
- Owner to decide: expenses can be added and edited but never deleted (no button, no endpoint). A wrong expense today can only be edited to RM 0.00.
- Owner to decide: should finance admins see Users and roles? The list refuses them (functions/api/users), so their built-in access is now none; management can still raise it, and then the page shows "could not load".
- Imported paid payouts have no paid date (the workbook has none), so Payouts shows "Date not recorded" for 531 of 536.
- Performance "Management fees" over 12 months only counts Aug 2026: the workbook's 整体报告 breakdown exists for that month alone.

## Reservations click sweep (fix/sweep-reservations, 11 Oct 2026)
- Owner to decide: a guest name "请设置姓名" (Airbnb's "please set your name" placeholder) arrives from the booking data; treat it as no name at import?
- Owner to decide: changing the dates or total of a booking that already has an issued invoice leaves that invoice for the old stay; warn, or void and reissue?
- Owner to decide: adding a guest with the phone of an existing guest gives no duplicate warning (merge exists after the fact).
- Owner to decide: finance_admin sees "Create reservation" on Bookings and the Dashboard; confirm finance should create bookings.
- The login page always logs one console 401 (GET /api/auth/session before sign-in); auth area, not changed here.
- `[font:inherit]` next to a text-size class resets the size to 16px; fixed in the booking drawer, Bookings and Guests, still present in Units, Owners, Users and Guest documents pages.

## Infrastructure, checked 11 Oct (replaces older guesses above where they differ)
- Verified: production and staging engine workers run code from before the renovation work. The phase-1 public photo route /api/scm/mfg-products/:id/photo/:key answers 401 (not mounted), while the old /api/scm/product-models/:id/photo/:key answers 404. Engine screens are current (published by .github/workflows/deploy-engine-production.yml).
- Verified: the GitHub CLOUDFLARE_API_TOKEN cannot deploy workers ("No access to the specified service" on conts-scm-engine); it can publish Pages. Fix, one of: invite the owner to the Conts ERP Cloudflare account (then `npx wrangler login` here), add Workers Scripts Edit to the token, or run `node scripts/engine-production.mjs deploy` on the machine holding C:/dev/Conts-ERP-deploy.
- Verified: Supabase organisation "Conts ERP" is on the Pro plan, so the database has Supabase's daily backups (7 days). The extra GitHub nightly backup (backup.yml) is not active: only CLOUDFLARE_API_TOKEN exists as a repo secret.
- Verified: production has migrations 0055 and 0098 (two-step sign-in database side).
- Not verifiable from this machine (may already be done; confirm with whoever runs the Conts ERP Cloudflare account): cron worker theconts-cron deployed, Workers Paid plan, Pages secret TOTP_ENC_KEY, Hyperdrive origin on the session pooler.

## Owner money screens (feat/ownermoney, no migration)
- No migration: the standard cleaning price is the unit's 'cleaning' row in unit_expenses; a building maintenance fee bill is category 'other' with a description starting "Building maintenance fee" (statement: Additional Deduction). Unit Financials: Costs this month (Cleaning, Maintenance, Paid on behalf) with Add a bill paid on behalf; Unit P&L this month; The Conts' share. Owner page: Expenses by unit, editable payout details (no longer on the unit form), statement make-up in place, Generate owner report.
- Generate owner report on the owner page builds only that owner's draft statement (POST /api/statements/generate ownerIds); it is refused only when that owner's statement is already sent, not when other owners' are. Owner to confirm that rule.
- The old "Recurring monthly costs" rows other than cleaning (never deducted) are listed once on the unit as "never deducted"; owner to decide whether any should become bills paid on behalf.


## Operations > Today (feat/ops-today, no migration)
- Every check-in and checkout opens its reservation; "Guest arrived" uses the booking's Check in move (applyMove), "Guest left" as before; the times recorded come from the audit trail and the clean's guest_left_at. Expected times change through PATCH /reservations/:id/details (same as the drawer). Tested: scripts/api-checks/ops-today.mjs (local PGlite).
- Maintenance on Today: visits booked that day, open urgent or unit-blocking jobs, and overdue ones (marked overdue, a visit over with the repair not finished, or a repair block ending by that day). There is no due date on a job; owner to decide whether jobs need one.
- Available units: no live stay that night (owner stays count as taken); ready / needs cleaning / cleaning now / blocked for repair. Tomorrow's readiness is today's unit state plus tomorrow's checkouts, so it is a forecast.
- Owner to decide: housekeepers and technicians still cannot open Today (they have their own field job list); "field staff" in the request may mean operations staff, who can.
- "Guest arrived" is allowed while the unit still needs cleaning (the booking drawer allows it too); owner to decide whether to block it.
- Not done: no test on staging data; scripts/dev-pglite.mjs is not on main (copied locally from another worktree for the browser check).
## Unit costs (feat/unit-costs, no migration)
- Unit Financials has one Costs panel (cards + one dated table, month stepper) read from GET /api/expenses/breakdown, the rows and month rule (incurred_on in the month) the owner statement uses; "Every expense this month" is gone. Owner page "Every cost" uses the same table.
- How a cost arrived is read, not stored: task_id = Cleaning job, maintenance_id = Maintenance job, utilities and condo fee = Bill, id 'wb-...' = Imported, else Manual. A source column would need a migration; not added.
- Finished cleans with no cost (imported as done without a price, or a second clean the same day) are listed on the unit with "Charge N cleaning jobs" (POST /api/expenses/clean-charges), dated the day each was finished. Default guessed: charged at the unit's cleaning price, owner pays; owner to confirm.
- A second clean on the same unit and day is still never charged automatically (chargeClean's import guard); it shows as uncharged and charging it is skipped too. Owner to decide whether two cleans in a day should both charge.
- Maintenance: the unit reads category maintenance / maintenance_id rows by incurred_on; feat/maintenance-rework must write the billing date into incurred_on for the month to be right. Not checked against that branch.
- Add a bill now covers every manual cost (Paid by included; Record expense removed); the bulk "Utility bills, all units" stays on the owner page only and now asks for a bill date (was the month's last day, unseen).
- Owner adjustments dated in the month are rows of the unit table; held ones and earlier open ones are listed below it as waiting. Their hold/release actions for in-month ones are on the owner page only.
- The statement and the panel both count rollup headers (parent_expense_id) with their line items; /api/finance/expenses does not. No rollups exist today; if they appear, decide which is right.
- scripts/api-checks/unit-costs.mjs runs in CI (rbac job). Locally on PGlite use STATEMENTS=lib: POST /api/statements/generate opens a second connection for its transaction and PGlite serves one, so it hangs there.

## Owner details (feat/owner-details, migration 0110)
- Done (12 Oct): migration 0110 applied on staging and production; the address fields are live.
- Production: 116 owners, none with phone or email yet (the source workbooks had none); they are entered on each owner's page (Owner details, Edit).
- Changing an invited owner's email on the owner page does not change their portal sign-in email; owner to decide whether it should.

## Layout and logo sweep (fix/ui-oct11, 11 Oct)
- Owner to send the original logo file (vector or large PNG): mark-gold.png is 117x136 and logo-gold.png 195x162, so the login hero (112px tall) is upscaled on 2x screens and soft. Rerun scripts/brand/make-logo-variants.py with it; the optical-centre nudge (MARK_OPTICAL in Logo.tsx) may need re-measuring.
- Calendar: the grid box has a fixed md:max-h-[74vh], so at 1366x768 and 1920x1040 the page scrolls 50-120px as well as the grid (two scrollbars). Swap it for useFillHeight in CalendarPage.tsx line ~489 once feat/calendar-bulk has merged (left alone to avoid a conflict).
- Guests: the list box is a fixed calc(100dvh - 420px) beside a profile that can be thousands of px tall (a repeat guest lists every stay), so the list scrolls out of view; make the left column sticky with useFillHeight({ column: true }) and cap the stay list. Owner to say whether a guest's stay list should page after ~20.
- Owner decision: at 1366x768 Reservations has room for only ~5 rows under the to-do cards, so the table takes a full screen and the page scrolls first (two scrollers by design, useFillHeight). Option: fold the four to-do cards into one row of chips on short screens.
- Two-step sign-in prompt (feat/two-step-prompt, owner 12 Oct): after each password-only sign-in a centred dialog asks the person to turn on two-step sign-in (Set up now opens My account; Later closes it until the next sign-in). Shows only where it can be set up (TOTP_ENC_KEY present, migration 0098) and the person has not got it. src/components/TwoStepPrompt.tsx, flag in src/lib/twoStepPrompt.ts raised by login() in session.tsx. Checked in the browser on a local server. scripts/add-two-step-key.mjs adds the key to live and staging (owner runs it once).
- IT Support (feat/it-support, owner 12 Oct): desk roles report a problem to the Houzs IT Hub from System > IT Support, or Support > IT Support in the supply chain workspace (same screen and requests, 13 Oct), and follow it there; a new request carries the screen the person was on before IT Support; requests live in the hub (system code CONTS), not in Conts. Open: set IT_HUB_URL and IT_HUB_API_KEY on production after the owner has seen it on staging; housekeepers and technicians have no IT Support in the field app yet (owner to decide); no api-checks suite yet (it needs a stand-in hub), the flow was run by hand against a local hub.
- Done (12 Oct): migrations 0100, 0103-0108 and 0110 applied on staging and production through the Supabase connector (one transaction each, recorded in pos_migrations with migrate-pg checksums).

## Renovation SO customer + property (feat/reno-customer-info, migration 0112, 14 Oct)
- Migration 0112 (project_property_types, project_layouts, property columns on projects and scm.mfg_sales_orders) is not applied anywhere but a local scratch database. Until it is, the engine shows Houzs's SO form unchanged (the lists read as not ready).
- Two-way rule (scm/shared/renovation-property.ts): the project is the master; saving an SO writes its customer, address and property back to its project (a blank email never wipes the project's); saving the project refreshes linked SOs that are still open (standard SO in DRAFT/CONFIRMED, not proceeded); proceeded, delivered or cancelled SOs and renovation contracts keep what they were printed with.
- Project screens (phase B): New project uses the same customer and property block (property saved right after the project is created); the project detail right column starts with a read-only Customer info card with Edit.
- New project (owner, 14 Oct): people are Project PIC + Attending (the Team card's picker; no Sales / Designer split); no "Customer is" (the server defaults it to an outside customer); no name field: a renovation project is named Building + Unit, else the customer name, and is renamed whenever its building or unit changes (Customer info, the old project PATCH, an SO save or an SO link). The RN- code stays the unique id; duplicate names are allowed.
- Owner to decide: whether converting a quotation should still move the project to Signed (today: Signed is set by hand only).
- Linking is manual from either side (owner, 14 Oct); linking an existing SO from the project copies its filled customer, address and property fields into the project (an empty SO value never clears one): the SO form's project picker and the project's Link existing SO set the same mfg_sales_orders.project_id and log so_linked / so_unlinked. "Signed" is set by hand only (flow.ts). A project can carry form SOs beside its one contract; Unlink on the project still takes off only the SO the project page shows.
- Rooms on a renovation-mode SO (owner, 14 Oct): mfg_sales_orders.room_sections (ordered list) and mfg_sales_order_items.room; New SO, Edit SO, the detail page (Room column) and the print (room headers) use them; totals and payments do not read them. The quotation has the same "Generate rooms from layout" on its sections, which carry to the contract on convert.
- Clicked in a browser (14 Oct): on Edit SO, adding a new line inside a room, moving a line and renaming a room, then Save and reload.
- Project Maintenance in renovation mode shows only Property types and layouts and Brands (owner, 14 Oct); People, main steps, task categories, project types and the default checklist are hidden, their tables and readers unchanged.
- Customer Type, Building Type and Relationship lists are hidden in SO Maintenance in renovation mode; customer type and ref no. are no longer shown on the renovation SO form.
- Check: scripts/api-checks/reno-customer-property.mjs (49 checks, local engine).

## Same customer block on the SO and the project (feat/reno-same-customer-block, migration 0115, 14-15 Oct)
- Migration 0115 (projects: salesperson_staff_id, address1/2, city, postcode, country, sales_location; projects.state reused; scm.mfg_sales_orders.attachments) is applied only to a local scratch database. Until it is applied the project keeps its single site address and no salesperson; SO attachments answer with a database error.
- One CustomerBlock (Order information first, then Customer | Delivery address) on New SO, Edit SO, New project, the Customer info Edit dialog and, read-only, the Customer info card. Same fields, labels and required marks (customer name, phone, address line 1, property type, layout, built-up sq ft); the project now requires them too, on create and edit.
- SHARED_FIELDS (scm/shared/renovation-property.ts) drives every sync: SO -> project, project -> open SOs, Link existing SO; an empty value never clears the other side.
- Rooms: every line belongs to a room (Common area until a layout is chosen; a line with no room shows and is saved there); rooms are made as soon as a layout is chosen while no line has a product; a line moves rooms from its Move button.
- SO attachments (photos and PDFs, 10 MB, up to 50) on the SO page, in the line-photo bucket; line photos are the existing per-line photos.
- Not checked locally: the State / City / Postcode cascade with real localities (the scratch database has none seeded).
- Check: scripts/api-checks/reno-customer-property.mjs (59 checks, local engine).

## Renovation document flow (feat/reno-doc-flow, migration 0116, 14 Oct 2026)
- OPEN, before merge: apply migration 0116 on staging, then production (lead). It adds the quotation's property block, project / building / unit / room on DO and SI, project + category on PO, room + category on PO and GR lines, the copy triggers and the one-category-per-renovation-PO rule. Until it is applied the engine reads as before (every new read checks the columns first).
- Next: raise POs automatically from the procurement dates (per category / sub-category PO date; expected = the delivery date). Not built.
- Later: carry the onsite / 3D / 2D design files onto the project's POs, GRs and DOs.
- The Houzs PO "Add line" screen shows a refused mixed-category line as a failed save (500 insert_failed with the sentence); a friendlier 409 would mean editing Houzs's PO route.
- Field-by-field list: docs/superpowers/plans/2026-10-14-reno-doc-flow-fields.md. Check: scripts/api-checks/reno-doc-flow.mjs (needs a local Postgres + PostgREST behind the engine's SUPABASE_URL).
- Sub-category settings: prints (PO, GR, DO, SI) still use the built-in sub-category names; a renamed one prints its old name, an added one prints its code in words. Send the label from renovation-doc-flow.ts to fix.
- Sub-category settings: a Service sub-category added in settings gets no generic RN-* SKU (migration 0064 seeded those once), so quotation lines for it need a real SKU.

## Automatic project Start / End date (feat/reno-auto-dates, migration 0117, 15 Oct 2026)
- OPEN, before merge: apply migration 0117 on staging, then production. It adds the insert trigger that stamps a new renovation project's start date and backfills existing ones (start = created day; end = day it entered Closed per step history, else closed_at, else last updated, for projects SQL can tell are Closed; cleared where nothing could have closed it). The engine works without it: the first read of a project fills its start from the created day.
- Start = created day (Malaysia); End = the day the step reached Closed (Move step or the data), cleared when it leaves Closed. Read-only everywhere; the project PATCH ignores both for renovation projects. Written where the step is computed (services/renovation/projectDates.ts): board, project page, step routes, contract hooks, Customer info and the SO's Order information reads.
- A project closed by its data alone (handed over + fully paid, no closed_at) before 0117 gets today as its end date the first time it is read, not the day the last payment came in (payments carry no date in the project facts).
- Check: scripts/api-checks/reno-customer-property.mjs (71 checks, local engine + PostgREST).

## Service case looks up the project (feat/reno-service-project, no migration, 15 Oct 2026)
- Renovation mode: the desktop New Service Case form picks a PROJECT (code, name, building / unit, customer, phone), fills the customer, phone, email and site address from it, stores project_id (migration 0081) and the project's newest SO as doc_no without asking; no Ref No; Product category is the renovation Category / Sub-category. List, detail header and side panel show the project as a link. Houzs mode unchanged.
- OPEN: the phone app's new-case screen (mobile/MobileServiceCase.tsx, MobileAssrSoField.tsx) still searches SOs; give it the same project picker (GET /api/assr/renovation/projects).
- OPEN: the Service Cases list search does not match the project code or name yet (services/assr.ts listAssrCases); search by customer or phone meanwhile.
- Check: scripts/api-checks/reno-service-project.mjs (34 checks, local engine + PostgREST).
