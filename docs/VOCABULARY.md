# Vocabulary (Property OS)

**Status: decided by the owner on 11 Oct 2026 (PR #168).** No screen has been changed yet. Phase 2 renames the
words across `src/` and `functions/` using `docs/vocabulary/rename-map.csv`, after the sweep PRs merge, and then
adds `scripts/checks/vocabulary.mjs` to `npm run check`.

The rule: **one idea, one word, the same on every screen, in every message, PDF and email.** We change only the
words people read. Stored values (`checked_out`, `cancelled`, `booking_com`, table and column names) stay as they are.

Where the words come from:

- **Rental side (reservations, guests, calendar, prices, listings, channels, messages, reviews, cleaning
  between guests): Airbnb's host words**, so staff who know Airbnb understand Conts straight away (owner's direction,
  11 Oct). Sources are in section 9.
- **Owner money (statements, owner portal, unit P&L): the owner's own Owner Income Report**, word for word
  (`_hostplatform-data/statement-sample-trion-a3503a-2026-09.pdf`). The units-owners sweep (`src/lib/statementTerms.ts`,
  PR in progress) already uses exactly these words; this document follows it.
- **Things Airbnb and the report do not have** (owners, contracts, maintenance, several channels at once, the supply
  chain): the plainest common word.

In the tables, **Source** says which of the three each word comes from.

What we found (`docs/vocabulary/inventory.csv`): **11,995 user-facing strings in 467 files**. **59 ideas** in the
glossary. **21 ideas have two or more names** in use, **11 words mean two different things**, and **a dozen kinds of
engineer words** (sync, webhook, audit log, field roles, SLA, ADR, RevPAR, MRP, 3PL, UOM) reach the screen. With the
owner's decisions, the check finds **989 words to change**. The rename map lists **636 strings in 853 places**: 14
single labels in the status and menu files, plus 622 strings found in screens and messages. 195 of them need
rewording, not just a word swap.

---

## 1. The owner's decisions (11 Oct 2026)

All 17 are decided. Rows 1 to 10 were the owner's choices; rows 11 to 17 follow the direction he had already given.

| # | Before (mixed) | Decided | Source | Places |
|---|---|---|---|---|
| 1 | Booking / Bookings / stay (the menu said "Bookings", the group "RESERVATIONS") | **Reservation**. The menu item becomes "Reservations". | Airbnb | 259 |
| 2 | Confirmed / Checked in / Checked out (status pill) | **Upcoming / Currently hosting / Past**. **Arriving soon** and **Checking out** are the date-based filters (section 2). | Airbnb | 7 labels |
| 3 | Cancelled vs Airbnb's "Canceled" | **Cancelled**, the British spelling the whole system already uses (Booking.com and Agoda spell it this way too) | Malaysian English | 118 |
| 4 | Unit / listing / room / apartment / property | **Unit** for the apartment; **Listing** only for a channel's listing ("Airbnb listing") | Owner report / Airbnb | 50 |
| 5 | Booking site / OTA / platform / site | **Channel** (Airbnb, Booking.com, Agoda, Direct) | Plain | 69 |
| 6 | Owner statement / owner report / income report | **Owner statement** on screens; the PDF keeps its title **Owner Income Report** | Owner report | 12 |
| 7 | Provisional / Finalised (statement status) | **Draft / Final** (then Sent, Paid) | Plain | 39 |
| 8 | Management fee / management share / commission (the operator's cut) | **"N% To Operator"** on owner money (the report's wording); **Operator share** as a field name on staff screens | Owner report | 40 |
| 9 | O2 / owner credits and charges / adjustment | **Owner Adjustments**; "O2" appears only on the printed line **Payout Before O2 Adjustment** | Owner report | 21 |
| 10 | Revenue / collected revenue / gross (staff dashboards) | **Earnings** on staff screens; **Gross Income** on owner money (same money, two audiences) | Airbnb / Owner report | 53 |
| 11 | Check-out / departure / arrival | **Check-in, Checkout** (nouns); check in, check out (verbs) | Airbnb | 86 |
| 12 | Base price / nightly rate / web rate / weekend rate / minimum stay / stop sell / off sale | **Nightly price, Weekend price, Custom price, Minimum nights, Blocked** | Airbnb | 48 |
| 13 | Gross booking value / booking value; site fee / commission; site payout | **Guest total; Service fee; Host payout** | Airbnb | 37 |
| 14 | Housekeeping / turnover / clean / task; housekeeper | **Cleaning** (screen), **Cleaning job** (one job), **Cleaner** (person and role) | Plain | 68 |
| 15 | Inbox | **Messages** | Airbnb | 2 + help text |
| 16 | ADR / RevPAR | **Avg nightly price / Earnings per available night** | Plain | 20 |
| 17 | Net payout / net owner payout / owner payout | **Net Payout to Owner** (the month's figure); **Owner payout** (the bank transfer; the screen becomes "Owner payouts") | Owner report | 22 |
---

## 2. Rental side (Airbnb's words)

| Idea | Use | Do not use | What it means | Source |
|---|---|---|---|---|
| A guest's reservation (the record) | **Reservation** | booking, stay (as the record), order | One guest, one unit, a check-in and a checkout date. "Book" and "booked" are fine as verbs. | Airbnb |
| A reservation not yet accepted | **Booking request** (status **Pending**) | pending booking | The channel is waiting for us to accept or decline. | Airbnb |
| A question before booking | **Inquiry** | enquiry | No dates are held. | Airbnb |
| Day the guest arrives | **Check-in** (noun), **check in** (verb) | arrival | | Airbnb |
| Day the guest leaves | **Checkout** (noun), **check out** (verb) | check-out, departure | Airbnb writes "checkout" as one word. | Airbnb |
| Person staying | **Guest** | customer, client, tenant (short stays) | "Customer" is the supply chain's word; "Tenant" only for long-term lets. | Airbnb |
| A unit's ad on one channel | **Listing** ("Airbnb listing") | | Booking.com calls its version a **room**: keep "room" only on the Booking.com linking screen. | Airbnb |
| Airbnb, Booking.com, Agoda, Direct | **Channel** | booking site, OTA, platform, site, source | See decision 5. | Plain |
| Nights nobody can book | **Blocked** ("Block nights", "Blocked nights") | stop sell, off sale, closed, hold, on hold | Why it is blocked is shown next to it: **Owner stay** or **Repair**. | Airbnb |
| Nights that can be booked | **Available** | open for sale, on sale, open | | Airbnb |
| Owner using their own unit | **Owner stay** | owner block, owner booking | A kind of block. | Conts |
| Price of one night | **Nightly price** | rate, base price, base nightly rate, web rate | The price before any weekend or custom price. | Airbnb |
| Friday and Saturday price | **Weekend price** | weekend rate | | Airbnb |
| Price set for chosen dates | **Custom price** | override, special rate | Wins over the nightly and weekend price. | Airbnb |
| Fewest nights allowed | **Minimum nights** | minimum stay, min stay | | Airbnb |
| What the guest pays | **Guest total** | gross booking value, booking value, GBV, total for the stay | Airbnb shows this as "Guest paid". We say Guest total because a direct guest may not have paid yet. | Plain |
| What the channel keeps | **Service fee** | site fee, platform fee, channel fee, commission | Airbnb's word. Booking.com and Agoda call theirs "commission"; on our screens it is one idea, so one word. | Airbnb |
| Fee the guest pays for cleaning | **Cleaning fee** | | The guest's fee on the reservation. Not the owner's "Basic Cleaning Fee" deduction (section 3). | Airbnb |
| What the channel pays us for one reservation | **Host payout** | payout (alone), site payout, booking site payout, collected revenue | Guest total less service fee and taxes. | Airbnb |
| Host payouts added up (staff dashboards) | **Earnings** | revenue, collected revenue, income, gross | The owner sees the same money as **Gross Income** (decision 10). | Airbnb |
| Share of nights booked | **Occupancy** | occupancy rate, % occupied | | Airbnb |
| Earnings per booked night | **Avg nightly price** | ADR | | Plain |
| Earnings per available night | **Earnings per available night** | RevPAR | | Plain |
| Talking to guests | **Messages** | inbox, thread, conversation | | Airbnb |
| Guest's rating and comment | **Review** | feedback, rating (for the whole thing) | | Airbnb |
| Messages sent by themselves | **Automations** | workflow, trigger (on screen) | Airbnb calls its version "Scheduled messages"; ours also create jobs, so keep Automations. | Conts |

**Reservation status (decision 2, decided 11 Oct 2026).** Stored values stay; only the pill changes.

| Stored | Before | Decided |
|---|---|---|
| `inquiry` | Inquiry | Inquiry |
| `pending` | Pending | Pending |
| `confirmed` | Confirmed | Upcoming |
| `checked_in` | Checked in | Currently hosting |
| `checked_out` | Checked out | Past |
| `cancelled` | Cancelled | Cancelled (decision 3) |
| `no_show` | No show | No-show |

**Today and Reservations filters** (decided 11 Oct 2026; worked out from the dates, like Airbnb's Today tab):
**Arriving soon** (check-in today or tomorrow), **Checking out** (checkout today), **Currently hosting**, **Upcoming**,
**Past**, **Cancelled**, **Pending**. A pill shows the stored status; "Arriving soon" and "Checking out" are only
filters and Today headings, never a pill. These headings come from the Airbnb app as hosts describe it; Airbnb's Help
Centre names only "Today" and "Upcoming" (section 9).

## 3. Owner money (the owner's Owner Income Report, word for word)

These are printed exactly as the report prints them, in Title Case, in its order. `src/lib/statementTerms.ts` is the
one place they live.

| Line on the report | Use exactly | Do not use | What it means |
|---|---|---|---|
| Heading | **Gross Income** | gross booking value, revenue, earnings (on owner screens) | What the unit's stays earned this month. |
| Its line | **Hospitality Income** ("29 nights, 96.67%") | room revenue, accommodation revenue | Host payouts for nights in this month. **Monthly Rent** for a long-term let. |
| Heading | **Expense Deduction** | costs, charges, expenses (on the statement) | What is taken off before the operator's share. |
| Lines | **Basic Cleaning Fee, Deep Cleaning Fee, Electricity Usage, Water Usage, Wi-Fi Subscription Fee, IndahWater Usage, Additional Deduction, Miscellaneous Charges** | housekeeping, cleaning (alone), internet, utilities, sewerage, maintenance (as a line) | One fixed name per kind. Repairs go under Additional Deduction with their own detail line. |
| Sum | **Total Deduction** | total deductions, total costs | |
| Subtotal | **Net Income Before Deduct Management Fees** (short form **Net Income**) | net (alone) | Gross Income less Total Deduction. |
| Operator | **15% To Operator** | management fee, management share, company share, commission | The operator's share (decision 8). |
| Subtotal | **Payout Before O2 Adjustment** | | Only when there are owner adjustments (decision 9). |
| Owner's own items | **Owner Adjustments** (each with its own text, e.g. "Maintenance Fee Sept 26") | O2, owner credit, owner charge | Credits and charges after the operator's share. |
| Fixed-rent contracts | **Fixed Rent, Minimum Guarantee Top-up, Fixed Rent Top-up** | guarantee pool, top up | |
| Final line | **Net Payout to Owner** | net payout, net owner payout, owner payout (for the figure) | What the owner receives for the month. |
| The transfer | **Owner payout** (screen: **Owner payouts**) | payout run, payment | The bank transfer that pays Net Payout to Owner. |
| The document | **Owner statement**; its PDF is titled **Owner Income Report** | owner report, income report, statement (alone in mixed screens) | Decision 6. |
| Statement status | **Draft, Final, Sent, Paid** | provisional, finalised | Decision 7. |
| Staff record of a cost | **Expense** | cost, charge, bill | On the statement an expense paid by the owner becomes a line under Expense Deduction. |

## 4. Places, people and operations

| Idea | Use | Do not use | What it means | Source |
|---|---|---|---|---|
| The apartment | **Unit** | property, apartment, room, listing (for the apartment) | Decision 4. | Owner report |
| A unit inside a unit (a room let on its own) | **Sub-unit** | room | | Conts |
| The building | **Building** | property, condo, project, development | The report's BUILDING. Menu group "PROPERTIES" becomes "UNITS". "Property OS" (product name) stays. | Owner report |
| The person who owns a unit | **Owner** | landlord, client, investor | | Owner report |
| The agreement with the owner | **Contract** | agreement, management agreement | | Plain |
| The owner's own website | **Owner portal** | portal (alone) | | Conts |
| Cleaning between guests (screen) | **Cleaning** | housekeeping | Owner, 10 Oct. | Plain |
| One cleaning of one unit | **Cleaning job** ("3 cleaning jobs") | clean (as a noun), turnover, task, session (on screens) | "Sessions" stays on the owner report's quantity column only. | Plain |
| Person who cleans | **Cleaner** | housekeeper | The role name too. | Plain |
| A repair (screen) | **Maintenance** | | | Plain |
| One repair on one unit | **Maintenance job** | issue, ticket, task, work order, repair (as the record) | "Report damage" stays as the button that opens one. | Plain |
| Person who repairs | **Technician** | handyman, vendor (for staff) | An outside company is a **Contractor**. | Plain |
| A job for a cleaner or technician | **Job** ("My jobs") | task, work | The field app's list. | Plain |
| Cleaners and technicians as a group | **Cleaners and technicians** | field roles, field staff, crew | Say who, not the role group. | Plain |
| Furniture and fittings in a unit | **Fit-out register** (item: **fit-out item**) | inventory (on the rental side) | "Stock" is the warehouse's. | Conts (owner, 8 Oct) |
| Door codes and keys | **Access** ("access code", "key") | credentials (on unit screens) | | Plain |
| Money action waiting for a second person | **Approval**; status **Waiting, Approved, Rejected, Withdrawn** | request (alone), pending (for approvals) | | Plain |
| Guest invoice and receipt | **Guest invoice, Receipt** | bill, document (alone) | Always "guest invoice" where a sales invoice could also be meant. | Plain |

## 5. One word, two meanings (fix these by qualifying the word)

| Word | Meaning 1 | Meaning 2 | Fix |
|---|---|---|---|
| Payout | What a channel pays us (Airbnb's sense) | What we pay the owner (Payouts screen) | **Host payout** and **Owner payout**. Never "payout" alone. |
| Cleaning fee | The guest's fee on a reservation | The owner's deduction | Guest side: **Cleaning fee**. Owner side: **Basic Cleaning Fee** / **Deep Cleaning Fee** only. |
| Adjustment(s) | Stock adjustment (supply chain menu "Adjustments") | Owner Adjustments (statement) | Menu becomes **Stock adjustments**. |
| Maintenance | Repairs on units | Catalog settings: "Products & Maintenance", "Case settings", "Project settings" | Rename the supply chain item to **Products**. Use "settings" for setup screens. |
| Receipt | Guest payment receipt | Goods receipt (supply chain) | Always **Goods receipt** in the supply chain. "Goods received" becomes Goods receipt. |
| Unit | The apartment | Unit of measure (UOM column) | The column becomes **Measured in**. |
| Job | Cleaning or maintenance job | "timed background job" in system messages | System messages say **the nightly run** or the job's name, never "job". |
| Blocked | Calendar nights | A user who cannot sign in ("Blocked") | A user: **Suspended**. |
| Inspection | Unit readiness "Inspection" | Vehicle inspection (fleet) | Unit readiness: **Checking**; the fleet keeps Inspection. |
| Rate | Old word for nightly price | Rate cards (transport delivery charges) | Rental side: **price** only. Rate cards stay in Transportation. |
| Returns | "Delivery returns" (menu) | "Sales returns" (the page itself) | One name: **Delivery returns** on both. |

## 6. Engineer words and how to say them

| Do not show | Say instead |
|---|---|
| sync, synced, syncing, full sync | Say what moves where: "Prices sent to Airbnb", "Updating channels", "Send everything again" |
| queued, queue | "Waiting to send" |
| failed to sync | "Not sent" + what to do |
| webhook, real time · webhook | "Live updates" (Integrations only) |
| audit log | "History" |
| field roles | "Cleaners and technicians" |
| endpoint, server, API (outside Integrations) | "the system"; on Integrations "API key" stays, it is what the vendor calls it |
| SLA | "Time allowed" |
| raw ids, UUIDs, codes like `checked_in` | Never shown. Document numbers (INV-2026-0912) are fine. |
| Channex, HostPlatform | Name them only on Integrations, the unit's channel setup and the import page. Elsewhere say "the channels" or "the import". |
| MRP, DP orders, 3PL, UOM (supply chain) | "Stock planning", "Delivery planning orders", "Delivery company", "Measured in" (supply chain screens, phase 2b) |

## 7. Writing rules

1. **Short.** A label is 1 to 3 words. A help line or toast body is one sentence, at most about 20 words. If it
   needs two ideas, use two sentences.
2. **Sentence case** for labels, buttons and titles ("Add reservation", not "Add Reservation"). The exceptions are
   the owner report's terms in section 3, which keep the report's Title Case, and sidebar group names (UPPERCASE).
3. **Buttons start with a verb and name the thing:** Add, Save, Send, Approve, Block nights, Check in, Mark ready,
   Record payment. Not "OK", "Submit", "Yes". One verb per action everywhere: **Add** (not Create/New for buttons),
   **Remove** (taken off a list, can be added back) vs **Delete** (gone for good), **Cancel** only for cancelling a
   reservation or order; a dialog's way out is **Keep** or **Back**, not Cancel.
4. **Toasts say what happened, in the past tense:** "Reservation saved.", "Payment recorded." A failure says what
   did not happen and what to do: "Reservation not saved. Check the dates and try again."
5. **Errors (fail(...) messages)** are for people: what is wrong, then what to do. No codes, no status numbers, no
   field names from the code. "Checkout must be after check-in." not "check_out must be > check_in".
6. **Empty states:** why it is empty, then the next step. "No reservations match these filters. Clear filters."
7. **Numbers with what they are out of:** "3 of 12 units", "29 of 30 nights".
8. **Money** always through `src/lib/format.ts`: "RM 1,826.39"; a deduction is shown with a minus sign or in
   brackets on the PDF, as the report does.
9. **Dates** always through `format.ts`: "30 Sep 2026", ranges "16 Sep – 29 Sep 2026", time 24-hour "15:00".
   Months alone as the report does: "SEP 2026" on PDFs, "Sep 2026" on screens.
10. **English, Malaysian/British spelling** (finalise, colour, cancelled), except Airbnb's one-word "checkout".
11. **Name the channel** when it matters ("Airbnb listing"), otherwise say "channel".
12. **No emoji, no exclamation marks, no "please".**

## 8. What is in this folder and what phase 2 does

- `docs/vocabulary/inventory.csv`: every user-facing string (string, file:line, kind), made by
  `node scripts/checks/vocabulary.mjs --inventory docs/vocabulary/inventory.csv`. It reads the code (TypeScript
  parser): JSX text, label/title/placeholder props, toasts, `fail(...)` messages, PDF and email text. It skips
  SQL, CSS classes, keys and stored values, and the files the renovation session owns (`reno*`, `renovation*`).
  A few code strings still slip in; they are harmless in a list.
- `docs/vocabulary/rename-map.csv`: old string, suggested new string, the term, `how` (`swap` = a straight word
  swap; `reword` = the sentence needs rewriting, not just a swap), `decided` (2026-10-11 for every row), and every
  file:line. Made by `--rename-map`. The first 14 rows are single labels in the central files (`src/lib/status.ts`,
  `src/lib/navigation.ts`, `src/lib/vocabulary.ts`), which the word rules cannot catch because the same word is right
  elsewhere ("Confirmed" on a sales order). The suggestions are mechanical: phase 2 reads each one in its screen
  before applying it.
- `scripts/checks/vocabulary.mjs`: the check. It self-tests on planted bad and good samples, like the other checks,
  then lists every banned word in a user-facing string. Not in `npm run check` yet. `--counts` prints how often
  each banned word is used.

**Never rename** (the check already skips these): stored values and enums; the HostPlatform and Airbnb export
column headers (`RESERVATION_COLUMNS` and the like, which the import matches exactly); "Booking.com"; Booking.com's
"Hotel ID" and "room" on its linking screen; the owner report's printed lines; document numbers; URLs and file names.
Supply chain and renovation screens keep their own words (section 5 lists the few clashes).

Phase 2 order (starts when the lead says so, after the sweep PRs merge): `src/lib/status.ts` labels →
`src/lib/navigation.ts` and `src/lib/vocabulary.ts` (role and channel labels) → the rename map, screen by screen (owner portal and statements last, to stay in step with the units-owners sweep) →
update the old `copy.md` at the repo root, which still lists "Gross booking value", "Housekeeping" and "Net owner
payout" → add the check to `npm run check` (`scripts/checks/run.mjs`).

## 9. Sources

Airbnb host words, checked on 11 Oct 2026:

- Today and Upcoming tabs, "reservations", Earnings (completed reservations), Messages, "Canceled":
  https://www.airbnb.com/help/article/3037
- Blocked nights, minimum nights, preparation time, advance notice, "restricted check-in or checkout days", listing:
  https://www.airbnb.com/help/article/3612
- Nightly price, cleaning fee, host service fee, payout, Earnings dashboard: https://www.airbnb.com/help/article/3389
- Weekend price: https://www.airbnb.com/help/article/512 · Custom price: https://www.airbnb.com/help/article/37
- Reservation status (Pending, Confirmed, Canceled; the page groups them as pre-trip, during-trip and post-trip):
  https://www.airbnb.com/help/article/363
- "Check-in and checkout times", booking requests, private notes for co-hosts, earnings breakdown, "your payout":
  https://www.airbnb.ca/resources/hosting-homes/a/redesigned-reservations-765
- Today tab headings "Currently hosting", "Arriving soon", "Checking out", "Upcoming" (hosts' own reports; the Help
  Centre does not list them): https://community.withairbnb.com/t5/Community-cafe/Today-tab-enhancement-needed/m-p/1604012

Owner money: the owner's Owner Income Report, Trion A-35-03A, Sep 2026 (two pages: monthly and year to date).
