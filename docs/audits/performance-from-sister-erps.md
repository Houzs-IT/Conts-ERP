# Performance: bug classes from Houzs and Hookka, checked in Conts

Audit of 11 Oct 2026, branch `fix/audit-performance`. Scope: slowness, lag, timeouts and Cloudflare limits.
Houzs was read from `origin/main` of `Houzs-Project/houzs-work`, Hookka from `Hookka/hookka-main`. The ticket ids
come from `ERP-Ticketing-Study/00-总档案`.

## How it was measured

- Data: the real-sized local copy (`hostplatform-import.mjs --serve`, port 55447): 139 units, 4,288 bookings,
  3,441 guests, 4,024 tasks, 5,878 expenses and 543 statements. The database is PGlite, which serves one connection
  at a time, so queries that run in parallel in production wait in line here.
- API: every list, detail and dashboard endpoint the rental screens call, 7 runs each, p50 and p95. SQL was counted
  per request by a local-only query log in `functions/_lib/db.ts`, which is not committed.
- Screens: time until the page stops loading, at 1440 px, with throttling off and on. "On" means a local Fast 3G
  proxy: 562.5 ms latency, 1.44 Mbit/s down, a shared pipe and no cache. Six or more other workers were running on
  the same machine throughout, so wall-clock times are noisy. Before and after were taken back to back under the
  same load, and the counts (queries, KB) are the reliable figures.
- Plan limits, from `CLAUDE.md` and `TODO.md`: the Conts ERP Cloudflare account is on the free Workers plan
  (owner's decision, 8 Oct 2026). That plan allows 50 outside calls per request and a small CPU budget per request.
  Hyperdrive sits in front of Supabase. `functions/_lib/db.ts` opens one connection per statement, and a Worker
  holds at most 6 at a time. Query count is therefore what costs time in production, not query plans.

## Before and after (API, local real-sized data, same machine load)

| Endpoint | p50 before | p50 after | p95 after | Queries before | Queries after |
|---|---|---|---|---|---|
| `GET /api/units/detail` (unit page) | 673 ms | 218 ms | 292 ms | 27 | 20 |
| `GET /api/reservations/:id` (booking drawer) | 298 ms | 184 ms | 222 ms | 14 | 12 |
| `GET /api/reservations` (bookings list) | 156 ms | 78 ms | 126 ms | 5 | 4 |
| `GET /api/guests?sort=recent` | 138 ms | 99 ms | 122 ms | 4 | 3 |
| `GET /api/guests/:id` | 94 ms | 47 ms | 66 ms | 4 | 3 |
| `GET /api/reservations/calendar`, 30 nights | 162 ms | 134 ms | 139 ms | 8 | 8 |
| `GET /api/reservations/calendar`, a year | 261 ms, 1,354 KB | refused (422) in 30 ms | - | 8 | 1 |
| `GET /api/nav/badges` (every page, every minute) | 153 ms | 185 ms | 211 ms | 8 (4 in series) | 8 (all in parallel) |
| `POST /api/rates/bulk`, 10 units, a year, weekend prices | 121,148 ms | 1,203 ms | - | 6,317 | 35 |
| `POST /api/rates/bulk`, all 139 units, a year | not run (about 88,000 queries) | 12,630 ms | - | - | 422 |
| `POST /api/reservations/import`, 500 rows in one request | 70,533 ms | refused; the screen sends 50 at a time | - | 4,002 | - |
| `POST /api/reservations/import`, 50 rows | - | 6,030 ms | - | - | 353 |
| `POST /api/statements/finalise`, 50 then 55 statements | 1,888 ms (50) | 260 ms (55) | - | 104 | 6 |
| `POST /api/statements/send`, 50 then 55 statements | 8,948 ms (50) | 3,673 ms (55) | - | 552 | 227 (220 of them are the emails) |
| `POST /api/statements/generate`, 105 owners | 747 ms | unchanged (already batched) | - | 21 | 21 |

Every other endpoint measured (about 35 more) had the same query count before and after, and stayed within 30 to
480 ms p50. Their after-times are often lower too, but that is the machine load changing, not the code.
Raw results: `perf-before2.json` and `perf-after.json`, in the worktree's parent folder, not in the repo.

Screens (first load, no cache):

| | Before | After |
|---|---|---|
| Entry script every page loads | 1,265 KB (283 KB gzipped) | 546 KB (152 KB gzipped) |
| JavaScript downloaded to show Dashboard / Bookings / Calendar / Guests / Units | 310 / 339 / 329 / 337 / 344 KB | 182 / 212 / 201 / 210 / 216 KB |
| On Fast 3G, that is | | about 0.7 s less download per first visit (128 KB at 1.44 Mbit/s) |
| Time to usable on Fast 3G (Dashboard / Bookings / Calendar / Guests / Units) | 5.5 / 7.1 / 10.7 / 10.4 / 10.9 s | 5.8 / 8.5 / 15.0 / 13.2 / 19.1 s |

The second row of timings is noise, not a slowdown. In the "after" runs the 150 KB entry file alone took 4.6 to
17.6 s to arrive through the proxy, against 4.4 to 9.5 s for the 283 KB file before it, so the machine was busier.
The bytes are the dependable measure. Unthrottled, every rental screen was usable in 0.1 to 0.9 s on both builds.
The largest page had 5,928 DOM nodes (Calendar, 139 units by 30 nights). Hidden-tab polling and query counts are
what change production cost.

## Catalogue

Verdicts: **present** = found in Conts and fixed in this PR; **present, open** = found and left (reason given);
**partly** = some of it applies; **not present** = checked and clean.

| # | Class | Where it hit the sister ERPs | How it would show in Conts | What was checked in Conts | Verdict | Fix |
|---|---|---|---|---|---|---|
| 1 | Unbounded "all" in one request until the Worker dies | Houzs #2479 `55982b051`: `so-pull?mode=all` ran 39 s, then 503 "Worker exceeded resource limits" | A screen asking for everything at once | `reservations/calendar` took any `from`/`to`: a year was 1.35 MB over 8 queries | present | Window capped at 92 days, dates validated, 422 otherwise (`functions/api/reservations/calendar.ts`) |
| 2 | Calls to outside services over the per-request cap | Houzs #3975 `392cb9fc3` (1,923 reads in one export); Conts engine itself (`TODO.md`: delivery order makes 83 calls, free plan allows 50) | One request making more than 50 `fetch` calls | Statement send emails each owner in the same request: about 100 emails a month | present, open | Business decision (below): Workers Paid, or deploy the cron so emails queue. Every database write before the emails is now batched |
| 3 | Silent truncation at a row cap | Houzs #3524 `a2587cdd5`, #2512 `481d83c3c` (PostgREST 1,000-row cap) | A list that quietly stops at N | Conts uses SQL with explicit paging, not PostgREST. Fixed `LIMIT 500` on `reviews/index.ts` and `integrations/channex/status.ts` | partly | Reviews: 0 rows today; paging is needed before 500 reviews arrive (`TODO.md`) |
| 4 | Cap applied before the filter, or client and server caps disagree | Houzs #3856 `540cae277`; ticket HZ-41 (UI asked 500, server gave 200) | Searches come back short | Guests, bookings and statements filter in SQL before paging. The import cap and the screen's batch size now share one rule (100 / 50) | not present | - |
| 5 | N+1: a query per row in a loop | Houzs #3963 `4f0c5de7f` (300 round trips, 116 s), #4286 `4f5719364`; Hookka BUG-2026-07-17-005; HK-33 | Bulk actions take minutes or die | Scanned every rental handler. Bulk prices: 2 queries per date range per channel (6,317 for 10 units). Import: 8 per row. Finalise: 2 per statement. Send: 11 per statement | present | Batched (`channexQueue.enqueueRestrictionsMany`, `statements/finalise.ts`, `statements/send.ts`, import unit lookup). New gate `scripts/checks/no-query-in-loop.mjs` |
| 6 | Long batch with a transaction per item | Houzs #4288 `522771861` (nightly restamp hit 30 min) | A cron run that grows with data | Cron worker (`functions/_lib/cronJobs.ts`) is not deployed; its loops retry due rows only | not present (cron off) | Allow-listed in the gate with its reason |
| 7 | O(N x M) join in JavaScript | Hookka C14 / #275 `a00250fa` (35 M comparisons) | CPU burnt on a list | `groupBy` maps in `revenue.ts`, `ownerStatement.ts`. `rates/bulk.ts` searched `connected` and `savedUplifts` per unit (139 x small) | not present | - |
| 8 | Whole data set downloaded to show a small figure | Hookka #293 `04332355`, BUG-2026-08-13-001 (2,539 POs for one tile) | Dashboard tiles fetch every booking | Dashboard, portfolio and nav counts are SQL aggregates (1 to 29 KB) | not present | - |
| 9 | Totals computed over pages in JavaScript | Houzs #2428 `a573316a0`; ticket HZ-50 | Wrong or slow totals | Bookings, statements and expenses return SQL totals with the same filters | not present | - |
| 10 | Waterfall of sequential awaits | Houzs #4205 `bec06bf26` (150 sequential round trips) | Latency x round trips | `nav/badges` (every page, every minute) awaited 4 reads one after another. Others use `Promise.all` | present | `functions/api/nav/badges.ts`: one `Promise.all` |
| 11 | Non-critical work on the critical path | Houzs #2834 `0f90d611c`, #3650 `09dc39bb2`, #3016 `39c1a6555` | Save waits for a sync or an email | Channex goes through the outbox (queued, flushed after the response). Emails in `statements/send` are still awaited | partly | Same open item as class 2 |
| 12 | Heavy computation at first paint with no cache | Hookka BUG-2026-07-13-001 (8 s) | Calendar or analytics computing everything per view | Heaviest read is the unit page (now 218 ms). Analytics over 12 months is 176 ms | not present at this size | - |
| 13 | Fake stale-while-revalidate | Hookka BUG-2026-07-14-008 | Stalls once a minute | Conts has no server cache layer | not present | - |
| 14 | Cache invalidation misses its source | Hookka BUG-2026-07-14-004 | Stale data after a change | No response caching on the rental side. The new per-worker caches hold only "this column exists", which never goes stale (a column is never dropped) | not present | - |
| 15 | Cold pool: first request after a quiet spell 503s | Houzs LESSONS [db-cold-start-503]; Hookka BUG-2026-08-01-002 | "Server busy" on the morning's first tap | `src/lib/api.ts` shows a plain message for 502/503/504 but does not retry a GET | partly, open | Retrying idempotent GETs once is a small client change; left for the owner of `src/lib/api.ts` (`TODO.md`) |
| 16 | Pooler exhaustion or wrong pool mode | Houzs `backend/wrangler.toml` (2026-06-13 outage) | Hyperdrive hangs while the DB is fine | `wrangler.toml` binds Hyperdrive; the pooler port is set in Cloudflare, not in the repo | not checkable from the repo | Owner/IT: confirm the Hyperdrive origin is the session pooler (5432) |
| 17 | Driver settings that fail under load | Houzs ARCHITECTURE (`max:1, prepare:false`); Hookka db-pg.ts (connect_timeout revert) | Every query 500s after a driver change | `db.ts`: `max: 1, prepare: false, fetch_types: false`, no connect_timeout | not present | - |
| 18 | One DB client shared across requests | Houzs LESSONS 2026-06-22; Hookka C9 | Intermittent 500s that grow with users | `db.ts` opens and closes per statement. The new module-level caches hold plain values, never a connection or a promise | not present | - |
| 19 | One page firing a burst of calls on load | Hookka PERF-BACKLOG ("12 parallel calls, ~1.9 s") | The last call waits for the others | Dashboard makes 6 API calls on load; nav badges are shared by sidebar, drawer and top bar (`navBadges.ts`) | not present | - |
| 20 | A request per keystroke | Houzs #4235 `34bfed6a3` | 504s while typing | Searches debounce; guests `q=` is one query (144 ms) | not present | - |
| 21 | `SELECT *` pulling large columns | Hookka BUG-2026-08-13-113 (base64 selfies, 1.28 MB) | Lists carry photos or JSON blobs | Photos are in R2, not in rows. Largest list payloads: properties 109 KB, owners 108 KB (117 owners, unpaged) | not present | - |
| 22 | Polling too often, or while the tab is hidden | Houzs `useAnnouncementBanner.ts`; Hookka P7 | Request quota spent by idle tabs | Nav badges polled every 60 s in hidden tabs (1 request and 9 queries a minute per open tab, all day). System health polled every 60 s while hidden. The bell already checked visibility | present | Both skip while hidden and refresh when the tab is shown again (`src/lib/navBadges.ts`, `SystemHealthPage.tsx`) |
| 23 | A shell preloading another screen's data | Hookka BUG-2026-07-14-007 | Slow landing on phones | Field and owner accounts get their own shells (`FieldShell`, `OwnerShell`), which do not mount the management dashboard; not measured on a phone | not present (by reading) | - |
| 24 | Bundle bloat, no lazy split | Hookka #285 `ef5e529e`; Houzs #4335 `13125c6f8`, `check-bundle-size.mjs` | Slow first paint | `Icon.tsx` imported all of lucide-react: 771 KB of the 1,265 KB entry. Pages were already lazy | present | Only the icons named in the source are bundled (`scripts/build/usedIcons.mjs`); new gate `scripts/checks/entry-bundle.mjs` (180 KB gzipped budget). libphonenumber (149 KB) stays in the entry because `src/lib/format.ts` formats phones everywhere |
| 25 | Huge unvirtualised DOM | Hookka #281 `6f0c84de` (46,137 nodes) | Scrolling freezes | Largest: Calendar 5,928 nodes, Payouts 5,773, Statements 5,184 | not present at this size | - |
| 26 | Re-render loop | Houzs #3952 `de86eb7f8` | Tab freezes | No runaway requests seen in the network log across 26 screens | not present | - |
| 27 | Timeout shown as "empty" or "not found" | Hookka #291 `5989b160`; Houzs #4219 `91adc0ef3` | Slow day reads as "no bookings" | `useApi` keeps a separate error state; `DataState` shows it | not present | - |
| 28 | Deploy breaks open tabs (stale chunks) | Houzs #3827 `c9ad7527a`, #4223 `dc4f2f8e3` | Lazy pages fail after a deploy | `UpdateNotice.tsx` (version.json) and `CrashScreen`/`main.tsx` handle failed dynamic imports | not present | - |
| C1 | Schema probe on every request (Conts's own) | - | An `information_schema` query (one more connection) per request | `moneySchema` (bookings list, booking drawer, payments), `hasGuestColumns` (guests), the booking drawer's optional columns: re-asked every request. `hasColumn` in `auth.ts` already cached | present | Remembered per worker once found (`bookingMoney.ts`, `guestList.ts`, `reservations/[id].ts`) |
| C2 | Same read repeated within one request (Conts's own) | - | Settings and month inputs read 3 and 2 times | `units/detail.ts`: `statementSettings` x3, `loadInputs` x2 | present | Request-scoped memo of the read function |
| C3 | Missing indexes on hot lookups (Conts's own) | Houzs migrations 0104, 0111, 0221, 0232 (hot-path indexes) | Full scans that grow with every booking | EXPLAIN on 23 hot queries: whole-table scans for tasks by unit or booking, bookings by guest, threads by booking, notification log by record, audit log by date, statement lines, payouts by statement, statements by month. All under 3 ms at today's size | present (grows) | `migrations-pg/0099_lookup_indexes.sql`, 11 indexes; EXPLAIN after shows index scans |
| C4 | Free-plan CPU budget on big writes (Conts's own) | Houzs moved to Workers Paid after "Usage limit exceeded" (LESSONS [cloudflare-plan-cap]) | A bulk price update for all units builds 152,205 rate rows in one request | Measured 12.6 s locally with 422 queries. CPU on Cloudflare is not measurable locally | present, open (UNTESTED on Cloudflare) | Business decision below |

## Business decisions needed

1. **Workers Paid plan for the Conts ERP account** (USD 5 a month, already flagged for the supply chain engine).
   On the free plan, sending a month of statements makes about 100 email calls in one request against a limit of
   50. Calls past 50 fail: the statement is still sent and the email is logged as failed, but nothing retries it
   while the cron worker is off. A price update for all 139 units over a year is also likely to exceed the free CPU
   budget. Options: (a) upgrade, which removes both problems (recommended, and the engine needs it anyway);
   (b) deploy the cron worker so failed emails are retried, and send statements in batches of 40 or fewer;
   (c) stay as is, and send statements 40 at a time by hand.
2. **Hyperdrive origin port.** Ask IT to confirm Hyperdrive points at Supabase's session pooler (5432). Houzs's
   outage came from the transaction pooler.

## Gates added

- `scripts/checks/no-query-in-loop.mjs`: no `await all/one/run/audit/notify` inside a loop in the rental handlers.
  Each allow-listed file has its reason; four are open items in `TODO.md`. It self-tests on a planted bad sample.
  It flags the old `statements/finalise.ts` (2 hits) and `statements/send.ts` (7 hits).
- `scripts/checks/entry-bundle.mjs`: the entry script must stay at or under 180 KB gzipped (now 152 KB). CI builds
  before it checks; with no build it measures nothing. It self-tests on a planted 283 KB sample.
- `scripts/api-checks/performance.mjs`: 22 checks against the real-sized local server, covering the calendar
  window, the import cap, the batched finalise and send (states, payouts, history, no double send), and that the
  cached-probe screens still answer.
