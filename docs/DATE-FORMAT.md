# Date & Time Formatting Convention

**Owner's decision, 3 Nov 2026:** every full date in the system is numeric and year first, `2026/11/03`, the same rule
the supply-chain engine (MRP) has used since 25 Sep 2026. Screens, PDFs, notices and messages alike. Times are
unchanged: 24-hour, Malaysian time. Whole-month labels stay readable (`Nov 2026`, `November 2026`).

**Dream Crafter side, 11 Nov 2026 (YH, asked for by Dream Crafter's users):** on screens in the Dream Crafter
workspace every date reads day first, `16-11-2026`, timestamps `16-11-2026 14:06`, and the short form `16-11`. The
Conts side keeps the year-first rule above. The same helpers do both: `AppShell` calls `setDayFirst()` for the side
on view (the workspace of the address, else the side last picked in the sidebar), and the supply chain frame is told
with each menu move (`conts:navigate`, `dayFirst`). Nothing else changes: stored values, API payloads, date inputs,
CSV exports and file stamps stay ISO. Two Dream Crafter places with no side switch are day first too (YH, 11 Nov
2026, "dd-mm-yyyy for both"): the Projects print sheet (`engine/backend/src/routes/projects_print.ts`, through
`withDayFirst()`) and the Renovation Beta screens, whose "10 Nov 2026" month names now go through `fmtDate` /
`fmtDayMonth`. The engine server's other Dream Crafter text is day first too (YH, 11 Nov 2026, "for dreamcrafter
... all dd-mm-yyyy"): the service-case print and its "Printed" stamp (`assr_print.ts`), service-case notices
(`services/assrNotify.ts`), the purchase order print and email (`scm/lib/po.ts`, `scm/lib/po-email.ts`) and the
sales order date-filter label (`scm/lib/my-time.ts`). The Property OS server's text (`functions/_lib/format.ts`:
notices, the daily digest, the letterhead on owner statements, agreements and guest invoices) serves only The Conts
side, so it stays year-first. Ledger references (`engine/backend/src/acc/journal-refs.ts`) serve both sides' Finance
and stay year-first.

Single source of truth on the screens: [`src/lib/format.ts`](../src/lib/format.ts). On the server:
[`functions/_lib/dates.ts`](../functions/_lib/dates.ts). The engine keeps its own copy of the same rule
(`engine/frontend/src/vendor/shared/format.ts`, `fmtDate`). Never call `toLocaleDateString`, `toLocaleString`, or
hand-build a date in a component; `scripts/checks/formatting.mjs` fails the build on both, and on a hand-built
"day + month name" date.

- **Timezone:** MYT = `Asia/Kuala_Lumpur` = **UTC+8** (no DST)

## The one-line rule

| You are showing… | Render as | How |
| --- | --- | --- |
| A record / a specific day | `2026/09/16` (Dream Crafter `16-09-2026`) | `date()` |
| A period (month) | `Sep 2026` | `monthLabel()` |
| A data-entry field | native date picker | `<input type="date">` |
| A chat / activity time | `2 hours ago` | `relative()` |
| A file / export | `2026-09-22` | `fileStamp()` |

## Full reference

| Context | Helper | Example | Notes |
| --- | --- | --- | --- |
| Full specific date | `date(iso)` | `2026/09/16` | The default for any record, reservation, statement line, or timeline entry. |
| Date range | `dateRange(from, to)` | `2026/09/16 – 2026/09/29` | Both ends in full, en dash between. Stays, statement periods, report windows. |
| Month period | `monthLabel(iso)` | `Sep 2026` | Whole months stay words. `monthLabel(iso, { long: true })` gives `September 2026` for one prominent title (the calendar's month header). |
| Year | `year(iso)` | `2026` | |
| Data-entry input | native `<input type="date">` | browser picker | Value stays ISO `yyyy-mm-dd` in state and transport. Seed it with `dateInputValue()`. |
| Time | `time(iso)` | `15:00` | 24-hour, MYT. No AM/PM. |
| Time with zone | `timeWithZone(iso)` | `14:06 MYT` | When the reader must not guess the zone. |
| Full timestamp | `dateTime(iso)` | `2026/09/16 14:06` | Audit rows, message receipts, "last synced". |
| Relative | `relative(iso)` | `2 hours ago` / `Yesterday` | Falls back to `date()` after a day. |
| Compact cell, year implied | `dateShort(iso)` | `09/16` (Dream Crafter `16-09`) | Month/day on The Conts side, day-month on Dream Crafter, as the engine's `fmtDayMonth`. Dense grids where the year is plain from the page. |
| Day header | `weekdayDate(iso)` | `Sat 10/10` | Cleaning, Today and the field app. |
| Stamp inside one job | `dateTimeShort(iso)` | `10/10 14:00` | |
| Long weekday date | `dateLong(iso)` | `Sunday, 2026/10/25` | |
| Calendar weekday cell | `weekdayDay(iso)` | `Wed 16` | Week/day calendar column headers (not a full date). |
| Filenames / exports | `fileStamp()` | `2026-09-22` | ISO, so files sort by name and the sheet reads it as a date. |

## Server text

`functions/_lib/dates.ts`: `numericDate(d)` gives `2026/11/03`, `numericDay(d)` gives `11/03`. Used by notices,
digests, reservation messages, expense and utility messages, the unit P&L notes and the printed letterhead
(`functions/_lib/letterhead.ts`). The owner statement PDF (`src/lib/statementPdf.ts`) prints its DATE field the same
way. Month headings on documents stay words ("SEP 2026").

Not yet changed: the owner portal's translated dates (`src/lib/portalI18n.ts`) and the demo endpoints
(`functions/api/demo/`), which other sessions own.

## "Today" must be MYT, never UTC

Compute the current day with **`todayMyt()`** (or `fileStamp()` for a filename). **Never** use
`new Date().toISOString().slice(0, 10)`: that is the UTC day, wrong for the first 8 hours of every MYT day.
