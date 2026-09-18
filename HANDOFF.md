# The Conts Property OS — what is built, what is not

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
| `/properties` | `PropertiesPage` | state → building → unit |
| `/owners` | `OwnersPage` | Owner list with units and fee |
| `/finance/statements` | `StatementsPage` | Selection, bulk send, confirmation dialog |
| `/system/users` | `UsersPage` | Accounts and roles |
| `/system/integrations` | `IntegrationsPage` | Four distinct connection states |
| `/system/settings` | `SettingsPage` | Organisation defaults |
| `/portfolio` | `PortfolioPage` | Every unit with occupancy, ADR, revenue, rating |
| `/properties/units/:id` | `UnitRecordPage` | Seven tabs: overview, reservations, operations, financials, maintenance, access, activity. One request via `GET /api/units/detail` — seven tabs firing seven round-trips is worse than one query set for a page opened dozens of times a day. Financial tabs are absent from the payload for roles without access, so the tab itself disappears. |
| `/operations/housekeeping` | `HousekeepingPage` | Cleaner roster by shift, unassigned work first |
| `/operations/maintenance` | `MaintenancePage` | Issues by state, owner-approval gate visible |
| `/operations/tasks` | `TasksPage` | Task list with photo requirement per row |
| `/operations/inspections` | `InspectionsPage` | Checklists, pass/fail, release gate |
| `/properties/inventory` | `InventoryPage` | Fit-out register, condition, replacement schedule |
| `/properties/access` | `AccessPage` | Masked codes with audited reveal |
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
| `AccessPage` | A read that is itself audited, with the audit stated in the toast |
| `InventoryPage` | Inline edit that PATCHes and reloads |

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

## Blocked on the client

1. **The vector logo.** Every logo position renders a marked placeholder.
2. **The shared font.** The brand guide requires one face across Houzs, Hookka and
   The Conts. Houzs ships Tahoma, Hookka ships IBM Plex Sans. This build uses IBM
   Plex Sans; changing it is one line in `tokens.css`.
3. **Property photography.** The login stage and unit records have image slots.
4. **Real figures.** Everything in `src/lib/mock.ts` and `scripts/seed-d1.sql` is
   representative placeholder data in a Kuala Lumpur and Petaling Jaya context.
