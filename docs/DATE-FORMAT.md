# Date & Time Formatting Convention

Single source of truth: [`src/lib/format.ts`](../src/lib/format.ts). Every rendered
date and time must go through a helper there — never call `toLocaleDateString`,
`toLocaleString`, or hand-format a date in a component.

- **Locale:** `en-MY` (Malaysian English)
- **Timezone:** MYT = `Asia/Kuala_Lumpur` = **UTC+8** (no DST)

## The one-line rule

| You are showing… | Render as | How |
| --- | --- | --- |
| A record / a specific day | `16 Sep 2026` | `date()` |
| A period (month) | `Aug 2026` | `monthLabel()` |
| A data-entry field | native date picker | `<input type="date">` |
| A chat / activity time | `2 hours ago` | `relative()` |
| A file / export | `2026-09-22` | `fileStamp()` |

`dd/mm/yyyy` appears **only inside the browser's native date picker**. It is never
rendered as text anywhere in the UI — not in tables, not in statements, not in PDFs.

## Full reference

| Context | Helper | Example | Rationale |
| --- | --- | --- | --- |
| Full specific date | `date(iso)` | `16 Sep 2026` | Unambiguous month name; no `03/04` day-vs-month confusion. The default for any record, booking, statement line, or timeline entry. |
| Date range | `dateRange(from, to)` | `16 Sep – 29 Sep 2026` | En dash, not hyphen. Year shown once when both ends share it, on both when they cross a year boundary. Used for stays, statement periods, report windows. |
| Month period | `monthLabel(iso)` | `Aug 2026` | Short month + year for statement periods, payout months, filter chips. A long form (`August 2026`) is reserved for **one** prominent page title, never repeated in lists or tables. |
| Year | `year(iso)` | `2026` | Year-only axes, annual rollups, copyright-style stamps. |
| Data-entry input | native `<input type="date">` | picker shows `dd/mm/yyyy` | Value stays ISO `yyyy-mm-dd` in state and transport; the browser renders the locale picker. Never build a custom text date field. Seed the field with `dateInputValue()`. |
| Time | `time(iso)` | `15:00` | 24-hour, MYT. No AM/PM — operators and OTAs read check-in/out in 24h. |
| Time with zone | `timeWithZone(iso)` | `14:06 MYT` | When cross-channel timing matters (guest in another zone, OTA webhook) and the reader must not guess the zone. |
| Full timestamp | `dateTime(iso)` | `16 Sep 2026 14:06` | Audit rows, message receipts, "last synced" — a specific instant, date + 24h time. |
| Relative | `relative(iso)` | `2 hours ago` / `Yesterday` | Inbox, activity feeds, notifications — recency reads faster than an absolute clock. |
| Compact table / calendar cell | `dateShort(iso)` | `16 Sep` | Dense grids where the year is implied by the surrounding period. |
| Calendar weekday cell | `weekdayDay(iso)` | `Wed 16` | Week/day calendar column headers. |
| Filenames / exports | `fileStamp()` | `2026-09-22` | Sortable ISO `yyyy-mm-dd` so exports and downloads sort chronologically by name. |

## "Today" must be MYT, never UTC

Compute the current day with **`todayMyt()`** (or `fileStamp()` for a filename),
both of which resolve to the Malaysian calendar day.

**Never** use `new Date().toISOString().slice(0, 10)`. That returns the **UTC** day,
which is wrong for the first 8 hours of every MYT day (00:00–07:59 MYT is still
"yesterday" in UTC). A booking created at 01:00 MYT on 16 Sep would stamp `15 Sep`
— off by one, every night, silently.

## Note on helper availability

`date()`, `dateRange()`, `time()`, `timeWithZone()`, and `todayMyt()` already ship
in `format.ts`. The remaining helpers listed here — `monthLabel()`, `year()`,
`dateTime()`, `dateShort()`, `weekdayDay()`, `relative()`, `dateInputValue()`, and
`fileStamp()` — land in the parallel PR `fix/date-format-conventions`. This document
is written as the **target convention**; use it as the spec once that PR merges.
