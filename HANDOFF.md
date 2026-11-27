# Conts ERP — what is built, what is not

Read this first. Two other files matter: `README-react.md` (how to run and deploy)
and `BUTTONS.md` (every button, its request, and the tables it touches).

## The two halves

| | Design reference | Production source |
| --- | --- | --- |
| Files | `The Conts Desktop.dc.html`, `The Conts Mobile.dc.html` | `src/`, `functions/`, `migrations/` |
| Purpose | What it should look like, clickable | What ships |
| Who reads it | Design review, QA | Engineering |

The `.dc.html` files are not compiled. They are the visual contract. When the React
and the design disagree, the design is right and the React is a bug.

## Screens in React

| Route | Component | State |
| --- | --- | --- |
| `/` | `DashboardPage` | KPI row, revenue/occupancy chart, exceptions, portfolio table |
| `/operations/today` | `OperationsTodayPage` | Risk-first queue, filters, SLA edge colour |
| `/reservations/calendar` | `CalendarPage` | 14-day grid, channel filters, drag target |
| `/reservations/bookings` | `BookingsPage` | Reservation list with channel marks |
| `/reservations/guests` | `GuestsPage` | Derived from reservations |
| `/owners` | `OwnersPage` | Owner list with units and fee |
| `/finance/statements` | `StatementsPage` | Selection, bulk send, confirmation dialog |
| `/system/users` | `UsersPage` | Accounts and roles |
| `/system/integrations` | `IntegrationsPage` | Four distinct connection states |
| `/system/settings` | `SettingsPage` | Organisation defaults |
| `/portfolio` | `PortfolioPage` | Every unit with occupancy, ADR, revenue, rating |
| `/properties/units[/:id]` | `UnitsPage` | The one Units screen (owner, 8 Oct 2026; replaced Properties, Units and Access and keys, whose old addresses redirect here). Left: state → building → unit tree with search, add/edit building, add unit and sub-unit. Right: the unit record with tabs Overview, Details & owner, Contract & documents, Access & keys, Reservations, Cleaning & maintenance, Financials, Activity (`?tab=`). The record is one request via `GET /api/units/detail`; editable master data comes from `GET /api/properties` and saves with `PATCH /api/units/:id`. Financials is absent from the payload for roles without access, so the tab disappears. |
| `/operations/housekeeping` | `HousekeepingPage` | Cleaner roster by shift, unassigned work first |
| `/operations/maintenance` | `MaintenancePage` | Issues by state, owner-approval gate visible |
| `/operations/tasks` | `TasksPage` | Task list with photo requirement per row |
| `/operations/inspections` | `InspectionsPage` | Checklists, pass/fail, release gate |
| `/finance/expenses` | `ExpensesPage` | Every deduction with category, date, reference |
| `/finance/payouts` | `PayoutsPage` | Failed payouts surfaced first, masked bank details |
| `/owners/contracts` | `ContractsPage` | Fee, term, renewal countdown |
| `/performance/analytics` | `AnalyticsPage` | Metric switch, best and weakest units |
| `/performance/pricing` | `PricingPage` | Base rate plus per-channel uplift |
| `/performance/reviews` | `ReviewsPage` | Ratings with reply state |
| `/communication/inbox` | `InboxPage` | One thread list across every channel |
| `/communication/automations` | `AutomationsPage` | Rules from notifications.md, toggleable |

All 28 navigation destinations resolve to a real page. `NotDesignedPage` remains only
as the fallback for an unknown hash.

## API in Cloudflare Functions

| Endpoint | File |
| --- | --- |
| `POST /api/auth/login` | `functions/api/auth/login.ts` — lockout after 5, role decides `home` |
| `GET /api/auth/session` | `functions/api/auth/session.ts` |
| `POST /api/auth/logout` | `functions/api/auth/logout.ts` |
| `POST /api/auth/forgot-password` | always 200, never discloses existence |
| `POST /api/auth/change-password` | policy enforced server-side |
| `GET /api/units` | owner-scoped, finance fields stripped by role |
| `GET /api/reservations/calendar` | server-provided channel and status labels |
| `GET /api/reservations`, `POST /api/reservations` | 409 returns the conflicting booking |
| `POST /api/statements/send` | finalised only, partial failure named |
| `GET /api/dashboard/kpis` | occupancy/ADR/RevPAR per the brand guide definitions |

## Endpoints

Every module has one. 27 route files across 21 directories, all following the same
shape: `requireSession` guard, role check, mutate, write `audit_log`, return partial
failures by name rather than failing the whole request.

| Area | Endpoints |
| --- | --- |
| Auth | login, session, logout, forgot-password, change-password |
| Workspace | dashboard/kpis, analytics |
| Reservations | reservations, reservations/calendar, guests |
| Operations | housekeeping/tasks, housekeeping/assign, tasks, tasks/complete, maintenance/issues, maintenance/approve, inspections |
| Properties | units, inventory, access-credentials |
| Finance | expenses, statements, statements/generate, statements/send, payouts, contracts, pricing |
| Growth | reviews |
| Communication | messages, automations |
| System | audit |

**Nothing is stubbed.** 37 endpoint files, zero `TODO` markers.

### Notification delivery

`functions/_lib/notify.ts` owns every outbound message. Call it and move on:

```ts
await notify(env, {
  template: 'owner.payout_paid', recipient: owner.email, channel: 'email',
  subject: 'Your payout has been sent', body: '…',
  entityTable: 'payouts', entityId: id, urgent: state === 'failed',
});
```

Four things it handles so no caller has to:

- **Idempotency.** The key is `{template, entity, hour}`, so a retry of the same event
  never double-sends. A duplicate returns the first result instead of sending again.
- **Quiet hours.** 22:00–08:00 MYT queues non-urgent messages until morning. `urgent: true`
  overrides it, and is used for exactly four things: a failed payout, a blocked unit, a
  password change, and a new field assignment.
- **Failure is a state, not an exception.** A provider error records `failed` with the
  reason and returns; it never throws into the action that triggered it. If the mail key
  is absent entirely the send records as `queued`, so a half-configured environment
  still works end to end.
- **The log is the audit.** `notification_log` holds template, recipient, channel,
  provider message id and state. `GET /api/notifications` surfaces failures rather than
  dropping them.

Wired into: cleaner assignment, damage reports, statement sends, payout paid and failed,
quote approval, user invitations, password changes, password resets, and outbound guest
replies on WhatsApp.

### Statement documents

`GET /api/statements/pdf?id=…` returns a print-ready HTML document with its own
`@page` rules, not a binary. Workers have no PDF renderer, and every consumer — portal
download, email attachment, finance export — can print to PDF from HTML with identical
output. If a binary is later required, point a headless-Chrome service at the same URL;
the markup needs no changes.

### Scheduled work

`functions/scheduled.ts` runs on the existing cron triggers. Three idempotent jobs:
drain the quiet-hours queue after 08:00, move tasks past their committed time to
`overdue`, and flag statements finalised but unsent for three days.

## Deploying

```bash
npm install
npm run setup          # database, migrations, admin account, demo data, secrets
npm run dev            # http://localhost:8788
```

To production:

```bash
npm run db:migrate     # applies 0001, 0002, 0003 to theconts-prod
npx wrangler secret put SESSION_SECRET
npm run deploy         # the Pages app
npm run deploy:cron    # the scheduled worker, deployed separately
```

**The cron is a separate Worker on purpose.** Pages Functions route by file path, so a
file at `functions/scheduled.ts` would be served as a URL instead of running on a
schedule. It lives at `worker/scheduled.ts` with its own `wrangler.cron.toml`, bound to
the same D1 database.

### Verified before handover

A build audit ran over all 56 source files and 37 endpoint files:

| Check | Result |
| --- | --- |
| Relative import paths resolve | all |
| Named imports match real exports | all |
| Unused imports (fails `noUnusedLocals`) | 15 found and removed |
| `React.*` type namespace without import | 8 found and fixed |
| Unused function parameters | none |
| Every page default-exports | yes |
| Routes point at files that exist | all 28 |

Two deploy-blocking problems were found this way and fixed: the cron file sitting in the
Pages routing tree, and the login hero `<img>` rendering a broken-image icon on a clean
install. The hero is now a CSS background, so the panel holds without artwork.

## Database

Two migrations, both D1/SQLite:

- `0001_init.sql` — users, owners, contracts, properties, units, guests, reservations,
  tasks, maintenance, expenses, statements, statement lines, payouts, integrations, audit
- `0002_operations.sql` — inspections, inventory, access credentials, reviews, pricing
  rules, message threads, messages, automations, documents, notification log, saved views

28 tables. Every table referenced by an endpoint is defined; verified by cross-check.

## Frontend data source

Every page is on the API. `src/lib/mock.ts` is deleted. Verified by cross-check: no
page imports mock data, and all 24 API paths the pages call resolve to an endpoint file.

`src/lib/useApi.ts` is the one hook. It takes a path and a fallback, and returns
`{ data, loading, error, reload }`.

**The fallback is deliberate.** A failed refresh keeps the last figures on screen behind
a labelled `<StaleBanner>` rather than blanking a page someone was reading. Each page's
`FALLBACK` constant is typed to its API payload, so it is also the shape documentation.
Remove a fallback once that endpoint is reliably seeded.

**Patterns worth copying when you add a screen:**

| Page | Pattern |
| --- | --- |
| `ExpensesPage` | Plain list: fetch, skeleton, filtered refetch, empty state |
| `StatementsPage` | Two mutations, partial failure that names only what did not send |
| `OperationsTodayPage` | The `409 ASSIGNEE_BUSY` round-trip — warn, confirm, retry with `force` |
| `InboxPage` | Two queries in one page, and no sent state before the server confirms |
| `units/AccessTab` | A read that is itself audited, with the audit stated in the toast |

## Decisions worth not relitigating

**Money is integer sen.** `RM 12,450.00` is `1245000`. Floats lose cents at scale and
owner statements must reconcile exactly.

**The status vocabulary is closed.** Seven reservation states, seven readiness states,
seven task states. No synonyms — not "Complete" next to "Completed". The enums in the
migration, the types in `src/lib/types.ts` and the labels in `copy.md` are one list.

**Each status tone is three values, not one.** `bg` for the tint, `fg` for text, `line`
for dots and borders. The brand guide's own status hexes fail WCAG AA as 11px badge
text on their own tints — success 4.18:1, warning 3.32:1, critical 4.45:1 — so they
live on `line` and the text foregrounds were darkened to 5.4–6.0:1. This is a
deliberate deviation from the guide; it is flagged in `tokens.json` under
`semantic.$accessibilityCorrection` and should go back to whoever owns the guide.

**Gold is never a status.** It marks the brand, the current selection, and Direct —
our own zero-commission channel. It is also not a text colour on white: `#C8A46A` is
2.34:1. Gold text uses `#8A6A2F`.

**Role decides the payload.** A housekeeper's task response contains no money fields
at all — they are not hidden with CSS, they are absent from the JSON.

**The double-booking rule lives in the API.** PostgreSQL had an `EXCLUDE` constraint;
D1 has no equivalent. `functions/api/reservations/index.ts` checks for overlap and
returns `409 DATE_CONFLICT` with the conflicting reservation attached so the UI can
say which guest is in the way.

**Sign-in has no portal picker.** One form for everyone; the account's role decides
where it lands. A picker asks the user a question the server already knows.

## AI Connector (MCP), 25 Nov 2026

Staff connect Claude or ChatGPT to the ERP with their own login: read-only, only what that login sees. Management
approves each person, sees every lookup and disconnects anyone on **System > AI Connector** (`/system/ai-connector`,
phone: Settings > System). Connector address: `https://erp.theconts.com/api/mcp`.

- **State:** code shipped behind migration `0378_mcp_connector.sql`. Until that migration is applied (Actions > Apply
  migrations to production, `only=0378`), every connector endpoint answers "not set up yet"; nothing else reads its tables.
- **Read-only by construction:** a tool call re-enters the API in-process (`functions/_lib/mcpDispatch.ts`) as a GET
  with the person's `ctmcp_` token and a per-isolate secret header; `functions/api/_middleware.ts` turns that into the
  person's session and every handler checks as usual. The token sent straight to `/api/*`, or on any write, gets 403.
- **Route table:** `functions/_lib/apiRoutes.generated.ts` is generated from the `functions/api` tree
  (`node scripts/gen-api-routes.mjs`; `npm run build` regenerates, `npm run check` fails when it is stale).
- **Admin = management** (`isMcpAdmin` in `functions/_lib/mcpStore.ts`). Owners and field accounts cannot use it.
- **Faster answers (owner: searching felt slow).** The AI used to walk list_modules -> list_endpoints -> erp_get and
  read replies of up to 60k characters. Now (`functions/_lib/mcpQuick.ts`, pure, tests `src/lib/mcpQuick.test.mjs`):
  - Quick answers, one call each, about 1-2k characters, read AS THE PERSON through the same `readValue` as erp_get
    (path gate, in-process GET, credential stripping), so access is unchanged:
    `business_summary {month}` = `/api/dashboard/kpis` for the month and the month before + `/api/dashboard/channels`;
    `reservations_summary {from,to}` = `/api/reservations?view=all&from&to` (the Reservations list's totals, tabs,
    channel / status counts and to-do cards); `today_summary` = `/api/dashboard/today` + `/api/dashboard/exceptions`.
    No Channex, HostPlatform or engine calls. Without finance access the money figures are simply absent (the
    endpoints leave them out) and the note says so.
  - `search {query}` / `fetch {id}` in the shape ChatGPT requires (outside Developer Mode it rejects a connector
    without them; deep research uses only them). search = `/api/search` (id `<kind>:<row id>`); fetch opens the
    kind's detail endpoint (`FETCH_SPECS`): reservation, guest, unit, owner, cleaning, expense / bill directly;
    maintenance and building are picked out of their list by id. Supply chain kinds (from the engine) have no fetch:
    the answer points to the link search gave.
  - `prompts/list` + `prompts/get`: monthly review, today at a glance, find a reservation; `prompts` advertised.
  - `erp_get` takes `fields` (keep only those keys, any depth); its cap is 30k (was 60k).
  - One token check per lookup: `functions/api/mcp/index.ts` remembers the identity it verified for 15 s
    (`rememberVerified`, per isolate) and the middleware's `connectorRequest` reuses it (`recallVerified`) for that
    request's in-process reads instead of querying `mcp_tokens` again. Every new request from the AI app is still
    checked at the door, so Disconnect / Remove stop the next request; reads already admitted may finish for up to 15 s.
  - Not yet measured live: reply sizes and timings on production need 0378 applied and a real session.
- **Actions, document flow, PDFs (owner, 26 Nov 2026, "confirm first, then do").** Behind migration
  `0380_mcp_pending_actions.sql` (NOT auto-applied: Actions > Apply migrations to production, `only=0380`) AND the switch
  "Allow AI actions (meetings, email)" on System > AI Connector (settings key `mcp.actionsEnabled`, default OFF).
  - `propose_meeting` / `propose_email` check everything (Meetings directory read as the person for people and meeting
    rooms; Mail Center Compose's own rules for email), store the exact body in `mcp_pending_actions` (10 minutes) and
    answer a summary + `confirmationId`. `confirm_action` claims the row once (`UPDATE ... used_at IS NULL AND expires_at >
    now RETURNING`, same token and person), then sends it through the ERP's OWN endpoint in-process as the person:
    `POST /api/meetings/meetings` (the IT Hub), or the Mail Center sign-on `POST /api/supply-chain/engine-session` and
    then engine `POST /api/mail-center/compose` (mailbox access is the engine's), signing the engine session out after.
    `cancel_action` drops one. Max 30 confirmed per person per 24 h. Every proposal / confirmation is in `mcp_calls`
    (recipients + subject for email, never the body).
  - Write fence: `mcpActions.ts ACTION_ALLOWLIST` (those two POSTs only) + `connectorDecision` in the session middleware:
    inner secret, action-id header, allow-listed method + path, and a single-use 60 s permit granted by confirm_action
    right after it consumed the row (`mcpInner.ts grantActionPermit / takeActionPermit`). Dispatched writes can only
    reach those two handlers (`mcpDispatch.ts actionRoutes`). Anything else with a connector token is 403.
  - `document_flow {number_or_id}`: reservation -> guest invoice / receipts -> payments -> unit owner -> owner statement(s)
    for the months of the stay; or a statement -> its units. Supply chain chains (engine) are not covered: those screens
    show their own linked documents.
  - `get_pdf {type, id}`: `statement` = the Owners page's own pdf-lib generator (`src/lib/statementPdf.ts`) run on the
    server, stored in MEDIA under `mcp-exports/`, 15-minute HMAC link served by `GET /api/mcp/export` (public; link is
    the credential). `guest_document` = the existing print page link (browser Print / Save as PDF; no server PDF exists).
    `mcp-exports/` files are not deleted automatically yet (an R2 lifecycle rule on that prefix would do it).
  - Tests: `src/lib/mcpActions.test.mjs` (fence, permits, lifecycle SQL on PGlite, validation, flow shaping, links).
- **Round 3 (owner, 26 Nov 2026): more quick answers, daily brief, Excel export, rate limit.** Code:
  `functions/_lib/mcpMoreTools.ts` (tools), `mcpMore.ts` (pure shaping, allowlist, limit), `mcpXlsx.ts` (hand-built
  .xlsx: zip + XML, deflate via CompressionStream, no new dependency). Tests `src/lib/mcpMore.test.mjs`. No migration:
  the limit uses the existing `mcp_calls (user_id, created_at)` index from 0378.
  - Every new tool reads ONLY through `readValue` as the person (same as erp_get), so the ERP's own RBAC and money
    hiding apply. A refused read becomes "Your account does not have access to X" and the rest of the answer still comes.
  - `occupancy_summary {month}` = `/api/portfolio/performance` + `/api/dashboard/kpis` + `/api/reservations?view=inhouse`
    (tonight by building from that list's building counts). `arrears_summary` = `/api/reservations?todo=unpaid&size=100`
    (direct guests owing, aged by days since check-in; host payouts outstanding) + `/api/sales-invoices` (customer
    invoices, overdue aged by due date). `owner_statement_summary {month}` = `/api/statements`. `attendance_today` =
    `/api/attendance` + `/api/leaves` (HR: office roles; field roles and owners get 403). `payables_summary` =
    `/api/purchase-invoices` (supplier bills, aged past due, due this week) + `/api/finance/payables?paid=no` (contractor
    claims). `today_summary` now also lists who checks in / out today (`/api/reservations?todo=arriving|departing`).
  - `daily_brief` (+ prompt `daily-brief`): 6 parallel reads: `/api/nav/badges` (the bell, already per role),
    `/api/tasks?assignee=u:<me>&to=today+3`, `/api/approvals?view=pending` (those `can.approve`), `/api/sales-orders`
    (target date), `/api/purchase-orders` (expected date), `/api/maintenance/issues?view=open` (due date). Each section:
    count, first 5, links. Mail Center: see round 4 (C1) below; it is now covered.
  - `export_excel {list, filters, search, from, to, fields}`: allowlist `EXPORT_LISTS` in `mcpMore.ts` (reservations,
    guests, units, tasks, maintenance, statements, expenses, guest_documents, sales_orders, sales_invoices,
    purchase_orders, purchase_invoices, suppliers, customers). Pages as the person up to 5,000 rows (first page gives the
    total, the rest 4 at a time), money columns in RM, header row frozen + autofilter, stored under `mcp-exports/` and
    served by the same 15-minute signed link as get_pdf (`/api/mcp/export` now sends the xlsx content type).
  - Rate limit, per person, `tools/call` only: 30 a minute, 600 a day (`RATE_PER_MINUTE` / `RATE_PER_DAY`), counted from
    `mcp_calls` (refused-for-limit rows, status 429, not counted). Over it: a normal tool result with isError ("Too many
    requests — wait a minute" / "Daily limit reached"), never a 500; a failed count lets the call through. The admin leak
    check never enters `callTool` (it uses `readEndpoint`), so it is not limited. The admin page shows the limits and
    the tool list read-only (overview `limits`, `tools`).
  - Speed: the rate limit's two counts ride in the door's token query (`resolveAccessToken(env, token, true)`, scalar
    subqueries on the 0378 index) plus a per-request counter for batches, so the limit adds no DB round trip per call
    (the separate `recentCallCounts` query is only the fallback). Every tool's reads run in one `Promise.all`; no tool
    reads per row (no N+1); export reads page 1 for the total, then the rest 4 at a time. The identity check is already
    once per request (`rememberVerified`). Local bench (PGlite + `wrangler pages dev`, demo data, management, median of
    7, ms): business 68 / 67, reservations 153 / 82, today 267 / 141, search 154 / 86, occupancy 115 / 97, arrears
    76 / 87, statements 52 / 54, attendance 63 / 143, payables 46 / 170, daily_brief 97 / 169, export 84 / 166 (before /
    after moving the counts into the door query). PGlite serialises every query, so parallel reads do not overlap and
    run-to-run noise is +-100 ms: the numbers show every tool answers in well under 300 ms locally, not a reliable
    before/after. Production timings are in `mcp_calls.ms` once people use it (not yet measured).
  - Not done: rent arrears (tenant rent on Agent-to-let records has no paid / unpaid record; the answer says so).
- **Round 4 (owner, 26 Nov 2026): "complete each system", read-only.** Code: `functions/_lib/mcpConts4Tools.ts` (tools,
  imports only pure modules so the tools themselves are unit-tested), `mcpConts4.ts` (pure shaping + the `period`
  convention). Tests `src/lib/mcpConts4.test.mjs`: every tool against a stand-in ERP as management, as staff without
  finance (money keys the real handlers drop stay dropped; statements / payouts / analytics / invoices 403) and as an
  account with no access (every tool answers "no access", no record leaks); each tool may read only the endpoints listed
  in `CONTS4_READS`. No migration.
  - **C1 daily_brief + Mail Center.** Why it could not read it: Mail Center lives on the engine; opening it needs the
    POST sign-on (`/api/supply-chain/engine-session`), and the connector only makes GETs (the write fence allows that
    POST only inside `confirm_action`). Fix: new read endpoint `GET /api/supply-chain/mail-waiting` (same gate as the
    Mail menu: no field / owner accounts, area `mail` not closed) sends the engine a one-minute signed statement
    (`aud: 'mail-waiting'`, `scmEngine.ts mailWaitingAssertion`) to the new engine route `POST /api/conts-mail-waiting`
    (`engine/backend/src/conts/mail-waiting-route.ts`), which checks Mail again and counts with the same query as
    `GET /api/mail-center/waiting-count`. **Read-only (main session, 27 Nov 2026): it never signs anyone on and never
    makes an engine account, session or mailbox.** No engine account, or no mailbox of their own yet -> `count: null`,
    "Mail Center not opened yet", and the brief says so. Not set up (501) = the brief says Mail Center is not included.
    **Needs the engine deployed** (Actions > the engine production deploy); until then the endpoint answers 502
    "the engine needs its update" and the brief lists Mail Center under couldNotRead.
  - `period` (every period tool): today | week (Mon-Sun) | month | last_month | quarter | year | custom (from + to), or
    `month` / `quarter` (YYYY-qN) / `year`; each compares with the period before (`resolvePeriod`).
  - Tools and reads: `unit_overview {unit|unitId}` = `/api/search?kind=unit` then `/api/units/detail` +
    `/api/lettings?unitId` + `/api/reservations?todo=unpaid`; `leases_expiring {days}` = `/api/contracts` + `/api/lettings`;
    `revenue_summary {period}` (month / quarter) = `/api/portfolio/performance` x2 + `/api/dashboard/kpis`;
    `housekeeping_today` = `/api/tasks?kind=cleaning` (today, overdue) + `/api/maintenance/issues?view=open` +
    `/api/dashboard/today`; `booking_pace` = `/api/reservations?view=all&st=live&export=1` for the next 90 days now, a
    month ago and a year ago (<=2 pages each); `channel_mix {period}` = `/api/reservations?ch=` x4 + period before +
    `/api/dashboard/channels`; `cancellations_summary {period}` = `/api/reservations` view=all / cancelled / period
    before / cancelledFrom-To; `reviews_summary {period}` = `/api/reviews` x3; `vacancy_summary {days}` =
    `/api/reservations/calendar` + `/api/units`; `owner_statement_summary {month, owner}` adds `/api/statements?period=all&q=`
    + `/api/payouts?q=`; `company_report {period, company}` = month: kpis x2, channels, performance, statements,
    reservations; quarter: performance x2, statements (all months), reservations x2; year (this year to date only):
    `/api/analytics?range=ytd`, statements, reservations x2; Dream Crafter: `/api/sales-invoices` + `/api/purchase-invoices`;
    `data_gaps` = `/api/units` (units under "Owner to be confirmed") + `/api/owners` (no bank details / no contract) +
    `/api/reviews?matched=no` + `/api/tasks?assignee=none` (next 3 days) + `/api/lettings` (rented, no end date).
  - Observed locally (PGlite demo data + `wrangler pages dev`, 26 Nov 2026), each tool over POST /api/mcp as a new
    Operations / Operations Staff account, compared with the same endpoints read directly with that account's cookie:
    the ERP refused contracts, portfolio, dashboard, statements, payouts, analytics, invoices and owners, and the
    connector named exactly those as "no access" (revenue_summary, Dream Crafter report and owner statements refused
    outright); money appeared only from what the ERP gave that account (reservation guest totals, the unit page's
    ADR / RevPAR). Management and Finance Admin got the full answers. Mail Center's waiting count answered 501 there
    (no engine locally): the live engine path is UNTESTED until it runs on production.
  - Skipped: none of C1-C11 / D4. Limits said in the answers: pace "booked by then" uses the reservation's created date
    (imported ones carry their import date) and cannot see later cancellations; company_report year is this year to
    date only (Performance's own range); revenue_summary takes a month or quarter (Portfolio's own periods).
- **Round 4b, write actions (owner, 26 Nov 2026, "那些也ok"; branch `feat/mcp-4bc`).** Code:
  `functions/_lib/mcpWrite.ts` (propose -> confirm, pure apart from its deps), the fence in `mcpActions.ts`
  (`ACTION_ALLOWLIST` patterns + `BODY_FENCE` + `connectorDecision` body check), the permit's `fence` in `mcpInner.ts`,
  the dispatch routes in `mcpDispatch.ts`, the real deps in `mcpActionTools.ts writeDeps`. Tests `src/lib/mcpWrite.test.mjs`.
  - **Needs migration `0396_mcp_write_actions.sql` (NOT applied; Actions > Apply migrations to production, `only=0396`).**
    Why: 0380 created `mcp_pending_actions.kind` with `CHECK (kind IN ('meeting','email'))`; 0396 only widens that list.
    Until applied: the two tools are hidden and answer "not set up (migration 0396)", their switches stay disabled.
  - Same mechanism as meetings / email: `propose_*` stores ONE pending action (10 minutes, single use, same token +
    person) and writes nothing; `confirm_action` -> main switch -> the action's own switch (peeked first, so a switched-off
    action is refused without using up the confirmation) -> 30-a-day cap -> single-use claim -> body fence -> ONE
    in-process call to the ERP's own route as the person. The route's own permission check, validation and audit decide.
    Every proposal / confirmation is a row in `mcp_calls` (target = kind + record, never the text) and, when done, one
    `audit_log` row `ai_connector.<kind>` (source `ai_connector`, record id + recipient / length, never the text).
  - **Switches:** System > AI Connector > "AI write actions", one per action, default OFF (settings `mcp.action.mail_reply`,
    `mcp.action.note`), management only (`POST /api/ai-connector/admin/settings {action, enabled}`), effective only while
    "Allow AI actions" (the main switch) is on.

  | Tool (args) | ERP endpoint it calls (existing) | What gates it (the ERP's own RBAC) | Switch |
  | --- | --- | --- | --- |
  | `propose_mail_reply {thread_id, body}` | Mail Center sign-on `POST /api/supply-chain/engine-session`, then engine `POST /api/mail-center/threads/:id/reply` with `{text, afterMessageId}` only; `force` is never sent, so the reply guard refuses (409) if a colleague replied after the proposal | the Mail Center area not closed (`levels.mail`, checked by `GET /api/supply-chain/mail-waiting`) + no field / owner accounts (`mayUseScmEngine`, also on the sign-on); the engine's Mail access and mailbox scope (`getMailScope`); only threads in `GET /api/supply-chain/mail-waiting?list=1` (waiting for this person: assigned to them, or unassigned in their own mailbox) | `mcp.action.mail_reply` |
  | `propose_note {target_type: reservation, number_or_id, note}` | `PATCH /api/reservations/:id/details` with `{staffNotes}` only (the drawer's Staff notes save); one `[Note <date> <name> (via AI Connector): ...]` line appended to the notes read at confirm time | area `reservations` at edit or above (middleware `accessFor` / `refusalFor`) + the handler's no-field-roles check | `mcp.action.note` |
  | `propose_note {target_type: cleaning_job, number_or_id, note}` | `PATCH /api/housekeeping/tasks/:id` with `{instructions}` only ("Notes for the cleaner"); same append | area `cleaning` at edit or above + no field roles | `mcp.action.note` |

  - **Mail Center, no new mailbox:** the engine sign-on gives a first-time person a mailbox (`conts/sso.ts`), so both
    propose AND confirm first read `GET /api/supply-chain/mail-waiting` (read-only; never signs on) and refuse with "Open
    Mail Center in the ERP first" when it says not opened; only then does confirm sign on. **Engine change:** the
    read-only `POST /api/conts-mail-waiting` takes `?list=1` and also returns the waiting threads (at most 10, longest
    waiting first, with the newest message id for the reply guard); `daily_brief` lists them with their `threadId`. The
    engine deploys by its own workflow (`deploy-engine-production.yml`, on push to main touching `engine/`); until then
    propose_mail_reply answers "the engine needs its update" and the brief shows only the count.
  - **Skipped:** notes on maintenance jobs (no note / comment endpoint: the only free text is the job description in the
    general `PATCH /api/maintenance/issues/:id`, which also re-derives the job state; no screen edits it); anything
    financial (payouts, invoices, statements). The cleaning job's `instructions` are set by the Cleaning page at creation
    ("Notes for the cleaner") and the PATCH documents them as editable; no current screen edits them after creation.
  - **Untested live:** every write against production through a real client (the unit tests use a stand-in ERP that
    applies the middleware's gate); the engine `?list=1` on production; migration 0396 on production.
- **Round 4c, platform quality (same branch).** Code `functions/_lib/mcpVisibility.ts` (pure), wiring in `mcpServer.ts`.
  - **P1 role-aware tools/list:** each read tool lists the endpoints it reads (`TOOL_NEEDS`); it is listed only when the
    person passes the session middleware's own module gate for those GETs (`accessFor` + `refusalFor`, with role, side,
    department and position read as the middleware reads them: `mcpActionTools.ts gateFor`). Action tools: listed only
    while the main switch is on (write actions: also their own switch, migration 0396 and the gate on the write). A hidden
    read tool called directly answers "Not available to your role ..." (status 403, note `no access`).
  - **P2 prompts per role:** `owner_morning_report`, `operations_review`, `reservations_revenue_review`, `finance_review`,
    `owner_relations_review` (plus the four before); `prompts/list` shows a prompt when one of its tools is listed
    (`mcpQuick.ts PROMPT_TOOLS`).
  - **P3:** the 20 quick answers (`STRUCTURED_TOOLS`) carry an open `outputSchema`; their results `structuredContent`
    (the same JSON as the text, which stays).
  - **P4:** a 60 s in-isolate cache per person + role + tool + arguments (`AnswerCache`, `CACHEABLE_TOOLS`: the 16 heavy
    summaries; today / cleaning / attendance / one unit stay live). A cached answer is logged with note `cached`.
  - **P5:** every quick answer gets `erpLink` (its ERP page); a row naming a record (`reservationId`, `unitId`, `ownerId`,
    `statementId`, `guestId`, `taskId`, `issueId`) without a link gets `url`; any `...Sen` left becomes `...Rm` (a hidden
    figure stays null).
  - **Untested live:** the filtered tools/list and `structuredContent` in Claude / ChatGPT.
- **Round 4d, morning brief email + urgent alerts (owner 26 Nov 2026, "加 全部一起做"; branch `feat/mcp-4d`).** Mirrors
  Hookka PR #1635. Code: `functions/_lib/mcpProactive.ts` (pure: config, due rules, alerts, debounce, email HTML),
  `mcpProactiveStore.ts` (tables), `mcpProactiveRun.ts` (runs as the person), `aiBrief.ts`; routes
  `functions/api/mcp/proactive/tick.ts`, `.../unsubscribe.ts`, `functions/api/ai-connector/brief.ts`, `brief/preview.ts`,
  `brief/test.ts`; page `src/pages/AiBriefSettings.tsx` (inside System > AI Connector); tests `src/lib/mcpProactive.test.mjs`.
  D3 (group monthly report) is built in IT Hub, not here.
  - **Opt-in, per person, off by default:** System > AI Connector > "Morning brief & urgent alerts by email". Brief
    on/off, time (Malaysia, half hours 06:00 to 22:00, default 08:00), weekdays or every day; urgent alerts on/off. Only
    for someone the AI Connector lets in (approved or management, active, a desk account) with a real email.
  - **As the person, always.** Each run issues the person a connector token of their own (client `mcpc_morning_brief`,
    5 minutes), checks it with `resolveAccessToken` like any AI app, and revokes it in `finally`. The brief is the
    `daily_brief` tool through `runToolAs` (= `callTool`); Monday adds `data_gaps` (D4, unchanged). Alert reads go through
    `readAsPerson` (= `readValue`: path gate, session middleware module gate, the handler's own checks, credential fields
    stripped). Arrears are only read for someone whose Finance level is above No access (`gateFor(...).level('finance')`),
    and an amount the ERP hid from them never passes a threshold. The brief's tool calls are logged in `mcp_calls`
    (client "Morning brief") and not counted toward the person's rate limit (`RATE_SQL` / `RATE_COUNT_SQL`).
  - **Alert rules** (`PROACTIVE_CONFIG`, the one place; shown read-only on the page), checked 07:00 to 20:00 MYT:

    | Alert | Read (as the person) | Rule |
    | --- | --- | --- |
    | Check-in at risk | `GET /api/dashboard/exceptions` (the Dashboard's "Check-in at risk"; now also returns `minutesLeft`, `readiness`, `assigned`) | guest arrives within 3 hours and the unit is not ready or has no cleaner; once a day per clean job |
    | Maintenance newly overdue | `GET /api/maintenance/issues?view=open&limit=200` | more than 3 days past `dueOn` (alerted when 4 to 5 days late, once) |
    | Money owed newly past 30 days (Finance only) | `GET /api/reservations?view=all&todo=unpaid&size=100`, `GET /api/sales-invoices` | RM 1,000 or more; guests 31 to 32 days since check-in, invoices 31 to 32 days past due; once |

    Known limit: the exceptions list carries the 5 riskiest clean jobs in the next 24 hours where nobody is assigned or
    the job is overdue (its own rule), so an assigned, not-yet-overdue job with a dirty unit is not alerted.
  - **Schedule:** the existing cron worker (`theconts-cron`, "Deploy scheduled jobs") runs `aiBriefTick` on its
    `*/15` trigger. Like `hubHealthReport` it only knocks: `POST ${APP_ORIGIN}/api/mcp/proactive/tick` with Conts's IT Hub
    key (`IT_HUB_API_KEY`, already held by both); the website runs the tick because a brief is the API's own routes run
    in-process as the person. Each tick: briefs due (first tick at or after the person's time, within 4 h, at most 10),
    alert checks (least recently checked first, none within 25 min, at most 15), a 20 s budget, people one at a time.
  - **Idempotent:** `mcp_proactive_keys (user_id, alert_key, day)`. `brief` is claimed (`INSERT ... ON CONFLICT DO
    NOTHING RETURNING`) before the brief is built; a build that fails gives it back. Alert keys (`checkin:<task>`,
    `maintenance:<id>`, `arrears:res:<id>`, `arrears:si:<id>`) are claimed before sending. The outbox row also carries an
    idempotency key per person per day (brief) or per tick (alerts).
  - **Email:** the existing outbox (`notify.ts` -> `notification_log`, Resend; the scheduled job retries failures).
    `Send.html` is new and optional: sent with the plain text when the send happens at once; a retry sends the plain text
    only (the HTML is not stored). Sent `urgent` so the 22:00-08:00 quiet hours (meant for guests and owners) do not hold
    a brief the person timed themselves. Each email is a row in `mcp_proactive_sends` (kind, items, notification id,
    result), never the subject or body.
  - **Unsubscribe:** `GET /api/mcp/proactive/unsubscribe?t=<32-char token>` shows one button and changes nothing (mail
    scanners pre-open links); the POST turns brief and alerts off (audited, logged). The token is the only credential.
  - **The person's own buttons:** Preview my brief (`GET /api/ai-connector/brief/preview?gaps=1`, built as you, shown in a
    sandboxed frame, NOT sent) and Send me a test brief (`POST /api/ai-connector/brief/test`, to your own address only,
    `[Test]` in the subject, with data gaps, at most once per 10 minutes).
  - **Migration `0397_mcp_brief_alerts.sql` (additive: three new tables). NOT applied** (Actions > Apply migrations to
    production, `only=0397`). Until it is, the tick answers
    "not set up here yet" and sends nothing, and the page section answers 503 "not set up yet".
  - **Untested live:** everything on production: no email was sent while building; the tick through the cron worker; the
    unsubscribe page in a real mail client; migration 0397.
- **FAQ (owner, 26 Nov 2026): each answered in ONE tool call.**

  | # | Question | Tool | Reads |
  | --- | --- | --- | --- |
  | C1 | Who owes rent, and how much (arrears ageing)? | `arrears_summary` | guests owing (aged), host payouts, customer invoices (aged). Tenant rent is not tracked: said plainly. |
  | C2 | What is occupancy today / this month, by building? | `occupancy_summary` | tonight by building + the month by building |
  | C3 | Which owner statements are pending or sent? | `owner_statement_summary` | Draft / Final (waiting to send) / Sent / Paid, with links |
  | C4 | Which check-ins / check-outs are today? | `today_summary` | counts + who (guest, unit, channel, link) |
  | P3 | How much do we owe suppliers? | `payables_summary` | supplier invoices per supplier, aged, due this week; contractor claims (finance only) |
  | E1 | What do I need to look at today? | `daily_brief` | see above |
  | E2 | Export X to Excel | `export_excel` | see above |
  | E1b | Any emails waiting for my reply? | `daily_brief` | Mail Center waiting-for-my-reply count (round 4) |
  | C5 | Who is in unit X now, who is next, does anyone owe, who owns it? | `unit_overview` | guest now / next, tenant, arrears, owner, month figures |
  | C6 | Which contracts / tenancies end soon? | `leases_expiring` | owner agreements + Agent-to-let tenancies, next N days |
  | C7 | Earnings, average nightly price, earnings per available night by building? | `revenue_summary` | month or quarter vs the one before (money: finance) |
  | C8 | What cleaning / repairs are on today, what is overdue? | `housekeeping_today` | cleaning today + overdue, repairs due |
  | C9 | How is our pace for the next 30 / 60 / 90 days vs last month / year? | `booking_pace` | on the books now vs then |
  | C10 | Airbnb vs Booking.com vs direct? | `channel_mix` | reservations, share, nights, guest total, avg nightly price, length of stay |
  | C11 | How many cancellations / no-shows? | `cancellations_summary` | rates vs the period before, lost guest total |
  | C12 | How are our reviews? | `reviews_summary` | average, by channel, bad reviews, not replied |
  | C13 | Which units are empty tonight? | `vacancy_summary` | empty tonight + empty nights ahead |
  | C14 | What did owner X get paid? | `owner_statement_summary {owner}` | their statements by month + payouts (finance) |
  | R1 | Monthly / quarterly / yearly management report | `company_report` | The Conts or Dream Crafter, vs the period before |
  | D4 | What data is missing? | `data_gaps` | units without owner, owners without bank / contract, ... |
  | A1 | Reply to that guest's email for me | `propose_mail_reply` -> `confirm_action` | an email waiting for you (threadId from `daily_brief`); sent only after your yes, not if a colleague replied first |
  | A2 | Note on reservation X / this cleaning job: ... | `propose_note` -> `confirm_action` | one dated line in the reservation's staff notes or the job's notes for the cleaner |
- Files: `functions/_lib/mcp*.ts`, `functions/_lib/aiConnector.ts`, `functions/api/mcp/`, `functions/api/ai-connector/`,
  `functions/.well-known/`, `src/pages/AiConnectorPage.tsx`, `src/pages/AiConnectPage.tsx`, tests
  `src/lib/mcpAccess.test.mjs`, `src/lib/mcpQuick.test.mjs`, `src/lib/mcpActions.test.mjs`, `src/lib/mcpMore.test.mjs`,
  `src/lib/mcpConts4.test.mjs`; round 4: `functions/_lib/mcpConts4.ts`, `mcpConts4Tools.ts`,
  `functions/api/supply-chain/mail-waiting.ts`; round 4b / 4c: `functions/_lib/mcpWrite.ts`, `mcpVisibility.ts`,
  `migrations-pg/0396_mcp_write_actions.sql`, `src/lib/mcpWrite.test.mjs`; round 4d: `functions/_lib/mcpProactive*.ts`,
  `aiBrief.ts`, `functions/api/mcp/proactive/`, `functions/api/ai-connector/brief*`, `src/pages/AiBriefSettings.tsx`,
  `migrations-pg/0397_mcp_brief_alerts.sql`, `src/lib/mcpProactive.test.mjs`.

- **Round 5, process help (owner, 27 Nov 2026: "how do I..."; branch `feat/mcp-howto`).** Mirrors Hookka PR 1640 /
  Houzs PR 6124 (same data model and honesty tests). Code: `functions/_lib/mcpHowto.ts` (pure answers + tool
  definitions), `functions/_lib/mcpHowtoTools.ts` (the person's access and side, gap log), data in
  `functions/_lib/howto/` (`types.ts`, `guidesConts*.ts`, `guidesDcSupplyChain.ts`, `flows.ts`, `modules.ts`,
  `glossary.ts`, `errors.ts`). Tests `src/lib/mcpHowto.test.mjs` + checks in `src/lib/howtoCheck.mjs`. No migration.
  - Tools (read-only, no ERP data read, so every connected person sees them): `how_to {question|topic, company}`,
    `module_overview {module}`, `glossary {term}`, `explain_error {text}`, `onboarding {role}`; prompts `how_do_i`,
    `explain_module`, `what_does_it_mean`, `explain_this_error`, `my_first_week`.
  - Guides to the full SOP standard (purpose, prerequisites, who / permission, fields with format and example, click
    steps with `?highlight=` links, checkBefore, result, warnings, undo, approvals, deadlines, commonMistakes,
    workedExample, related / nextStep, contact), tagged by company: 15 The Conts (reservations, check-in / out, guest
    payments and receipts, dates / cancel, cleaning, maintenance + owner approval, blocks, owners, units, letting,
    utility bills, owner statements, payouts, pricing, guest reviews) + 13 Dream Crafter (project, quotation, convert,
    VO, stages, defects + handover, instalment billing, collect payment, supplier, PO, purchase invoice, payment
    voucher, commission) + 2 shared (Mail Center, My claims). Flows: reservation to owner payout, new unit onboarding,
    renovation project quotation to handover, procure to pay.
  - Company: the person's side (Users and roles) picks the guides; management sees both; `company` overrides. A
    question only the other company answers says so (`otherCompany`) instead of showing it silently.
  - canDo = the session middleware's own gate (`gateFor`) for each `"METHOD /api/path"` a guide names, and the
    person's level for each `"area:<key>:<level>"` (Dream Crafter's screens are the engine's, which opens them from the
    levels sent at sign-on: engine/backend/src/conts/access.ts). No connector-only rule.
  - Honesty tests: every page is a router path (`src/App.tsx` routes + `scmEngine.ts` ENGINE_PATH menu addresses),
    every double-quoted label is in `src/` or `engine/frontend/src` (or the reservation drawer's server-sent move
    labels, `bookingLifecycle.ts`), every permission names a real handler method or area, every error fragment is
    still in the code. Business rules only from code, cited in comments beside each sentence.
  - Gap log: an unanswered help question is logged in `mcp_calls` with note `no-guide` (emails, phone and document
    numbers removed) and listed on System > AI Connector, "Questions with no guide yet" (last 30 days).
  - Known limit: on engine screens (Dream Crafter, Mail Center) `?highlight=` opens the screen but cannot outline the
    button inside the engine frame; answers say so (`engineScreen`).
- **Round 5b, screen map + `?highlight=` (branch `feat/mcp-howto-screens`).** Mirrors Hookka PR 1644 / Houzs PR 6130.
  Code `functions/_lib/mcpScreens.ts` (pure), data `howto/screensFull.ts` (21 busiest pages, button by button, with the
  permission each handler checks) + `howto/screensBasic.ts` (one line for every other router page; menu pages take
  title and sidebar path from `navigation.ts` NAV). Tools `explain_screen {path | visible_text}`, `where_is {thing}`.
  canOpen = the person's level on the page's menu area (`areaOfPath`); canDo per button = the ERP's own gate.
  Frontend: `src/lib/highlightMatch.ts` (pure matcher) + `src/lib/useHighlightParam.ts` (`<HighlightFromUrl />` in
  `AppLayout`): `?highlight=<label>` outlines the button for 6 s, read-only (never clicks or focuses), then drops the
  parameter. Tests `src/lib/mcpScreens.test.mjs` (every router page has one entry, labels, permissions, matcher).

## Mail Center re-synced with Houzs, 26 Nov 2026

The engine's Mail Center (Property OS > Mail) now matches Houzs ERP's (owner, 26 Nov 2026): per-person read state and
"read by", acknowledgements with a 48 h chase, failed replies queued instead of 502, personal mailboxes with
first.last@theconts.com given at the first sign-on with Mail access, claims an admin approves, recipient picker and
address suggestions, "What may I see", department-grouped sidebar, Delivered / Bounced, reply guard and auto-assign,
access levels L1/L2/L3 with an access change log, department mailboxes linked by id, file chips, the Inbound mail page
and the phone screens. Full write-up, adaptations and known gaps: `docs/MAIL-CENTER.md`.

- **State:** code on branch `feat/mail-center-resync`. It reads eleven new migrations, **0381 to 0391**, which must be
  applied (Actions > Apply migrations to production, dry run first) **before** the engine deploy that carries it.
- **New admin step:** every new personal address appears on Team, Mailboxes as "Waiting to be added in Cloudflare
  Email Routing"; it receives mail only after that custom address is added in Cloudflare (Send to a Worker:
  conts-mail-inbound) and marked added (or its first email arrives).
- **Scheduled work** rides the existing 5-minute call from the cron worker (`engineMailOutbox` ->
  `engine/backend/src/conts/mail-cron.ts`); nothing new to deploy on the cron side.

## Blocked on the client

1. **The vector logo.** Every logo position renders a marked placeholder.
2. **The shared font.** The brand guide requires one face across Houzs, Hookka and
   The Conts. Houzs ships Tahoma, Hookka ships IBM Plex Sans. This build uses IBM
   Plex Sans; changing it is one line in `tokens.css`.
3. **Property photography.** The login stage and unit records have image slots.
4. **Real figures.** Everything in `src/lib/mock.ts` and `scripts/seed-d1.sql` is
   representative placeholder data in a Kuala Lumpur and Petaling Jaya context.
