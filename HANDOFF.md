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
    count, first 5, links. **Mail Center is not covered**: it lives on the supply chain engine and its sign-on is a POST
    (`engine-session`), which the read-only connector cannot make; the brief says so.
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
- Files: `functions/_lib/mcp*.ts`, `functions/_lib/aiConnector.ts`, `functions/api/mcp/`, `functions/api/ai-connector/`,
  `functions/.well-known/`, `src/pages/AiConnectorPage.tsx`, `src/pages/AiConnectPage.tsx`, tests
  `src/lib/mcpAccess.test.mjs`, `src/lib/mcpQuick.test.mjs`, `src/lib/mcpActions.test.mjs`, `src/lib/mcpMore.test.mjs`.

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
