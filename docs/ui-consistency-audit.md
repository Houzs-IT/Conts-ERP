# UI consistency audit (3 Nov 2026)

Owner request, 3 Nov 2026: one look and one behaviour across Property OS and the supply-chain screens.

How it was checked: 41 Property OS screens loaded on the local PGlite copy (management login) at 375px and 1440px, in
light and dark, measuring sideways scroll, touch targets under 32px, hard-coded white surfaces and dark text on the
dark theme; then the code read for what a screenshot cannot show (dialog behaviour, wording, formats). The engine
screens do not run locally without their own server, so they were audited from `engine/frontend/src`. The owner
portal (`OwnerPortalPage.tsx`, `ownerB/`, `OwnerShell.tsx`) and Demo mode were left out: other sessions own them.

Already in good shape, and kept that way by `scripts/checks/`: status words and colours, date and money helpers,
no browser dialogs, no raw colours, English only. At 375px none of the 41 screens scrolls sideways; in dark mode none
shows a white panel.

Status: **fixed** = merged in the PR named; **open** = not done yet; **decision** = needs the owner's pick.

## Dialogs

1. **fixed (#593).** 19 form dialogs each built their own frame, so Escape, the backdrop and focus behaved
   differently from one to the next. Five ignored Escape entirely: Add / edit expense (`ExpensesPage.tsx`), catalog
   item (`MaintenanceCatalog.tsx`), Owner default operator share (`OwnerProfilePage.tsx`), Add a bill
   (`owners/Costs.tsx`), Start payout run (`PayoutsPage.tsx`). The shared `Modal` did not move focus in
   or back. In every one, a stray click on the dimmed backdrop threw away a half-filled form.
   Now one frame, `DialogFrame` in `src/components/Modal.tsx`: focus goes to the first field and back on close, Tab
   stays inside, Escape and the backdrop close it, and once a field has changed (typed, a native control, a pick in the
   shared `Select`) they ask "Discard your changes?" first. A choice made with plain buttons is not seen; such a dialog
   passes `dirty` itself. A pick in `Select` went undetected until batch 7. Also used by `AddUtilityBill`, `ApprovalBanner`, `BookingDrawer` (CentreModal), `GuestDocuments`,
   `CalendarModals`, `OpsUi` (OpsModal), `ContractsPage`, `DashboardPage`, `owners/ExpenseEntry`, `owners/OwnerMoney`,
   `owners/shared`, `StatementsPage`, `units/shared`.
2. **fixed (#593).** The approval and void-document reason boxes were `bg-white` (`ApprovalBanner.tsx`,
   `GuestDocuments.tsx`); now the card surface like every other field.
3. **kept on purpose.** The field app's full-screen repair sheets (`FieldRepairsPage.tsx`) and the photo viewers
   (`Attachments.tsx`, `ItSupportPage.tsx`) keep their own frames: they are full-screen views, not forms.

## Buttons

4. **fixed (#603).** New IT request form puts Send left of Cancel and on the left (`ItSupportPage.tsx`); everywhere else it is
   Cancel then the main action, on the right.
5. **fixed (#603).** Advance row edit shows Save before Cancel (`workers/AdvancesTab.tsx`).
6. **fixed (#603).** Export says five different things: "Export" (every table toolbar), "Export to Excel"
   (`finance/UtilityListing.tsx`, `UnitPnlPage.tsx`, `YearlyReportPage.tsx`), "Export Excel"
   (`OwnerOverallReportPage.tsx`), "Download CSV" (`ExpensesPage.tsx`), "Export all units" (`UnitsPage.tsx`).
   All page buttons now say "Export" with the download icon. "Download CSV" stays: it is the action button inside the
   expense report dialog, where naming the file is the point. "Export all units" on Units stays too: the list view also
   has the table's own Export (the rows shown), and the header one (every unit, every field) must not read the same.
7. **fixed (#603).** Title Case where the rest is sentence case: "Add Employee" (`workers/EmployeesTab.tsx`,
   `workers/DcEmployeesTab.tsx`), the "IT Support" page title (`ItSupportPage.tsx`). "Add employee" fixed; "IT Support"
   kept on purpose: it is the module's name, the same in the menu and in the sister systems (Hookka, Houzs Century).
8. **fixed (#603).** "Discard" (throw away unsaved edits) is a different button style on each of 14 screens (tertiary,
   secondary, ghost, plain): `CleaningSetup`, `MaintenancePage`, `ServicePrices`, `SettingsPage`, `units/UnitCleaning`,
   `settings/AgreementTemplate`, `GuestsPage`, `BookingDrawer`, `CategoryAccessEditor`, `permissions/*`.

## Money and numbers

9. **fixed (#603).** Service price ranges print the upper end without the thousands comma: "RM 1,000.00 – 1500.00"
   (`ServicePrices.tsx`).
10. **fixed (#603).** Headline money tiles drop the sen ("RM 12,450") on Owners (`OwnersPage.tsx`) and the Overall unit
    report (`OwnerOverallReportPage.tsx`), while the engine shows every amount in full. Owner's request: RM with sen
    wherever money is shown. Nightly prices on the calendar stay whole ringgit (they are set in whole ringgit).
    The same rule was dropping sen in 66 more places (`rm(x, { cents: false })`: Dashboard, Portfolio, Analytics,
    Statements, Reservations, Accounting, Guests, Maintenance, Cleaning, Contracts, supplier and customer credit limits,
    invoice and order totals). All now show sen; copy.md's money table and `MoneyText`'s default say so. Whole ringgit is
    kept only for nightly rates in the calendar and pricing grids, and compact amounts only on chart axes.
11. Not changed on purpose: payroll and advance exports (`workers/PayrollTab.tsx`, `workers/AdvancesTab.tsx`) write
    plain `1234.50` so Excel reads them as numbers.

## Dates

12. **fixed (#607), owner decided 3 Nov 2026: numeric `2026/11/03` everywhere.** The engine prints dates as `2026/11/03` (`engine/frontend/src/vendor/shared/format.ts`, Houzs's
    numeric-date rule of 25 Sep 2026, also on its PDFs); Property OS prints `3 Nov 2026` (`src/lib/format.ts`,
    `docs/DATE-FORMAT.md`). One helper changes it either way, but it reverses a recorded ruling, so it is the owner's
    pick. Times already match (24-hour, Malaysian time).
    Done: `src/lib/format.ts` (`date` 2026/09/16, `dateRange` with both ends in full, `dateShort` 09/16, `dateTime`,
    `weekdayDate` Sat 10/10, `dateLong`), `functions/_lib/dates.ts` for server text (notices, digests, reservation,
    expense and utility messages, unit P&L notes, the printed letterhead), and the owner statement PDF's DATE field.
    Whole-month labels stay words (Nov 2026; the calendar header November 2026). `docs/DATE-FORMAT.md`,
    `docs/VOCABULARY.md`, `docs/UI-STANDARDS.md` and `copy.md` updated; `scripts/checks/formatting.mjs` now also fails a
    hand-built "day + month name" date. Left: the owner portal's translated dates (`src/lib/portalI18n.ts`) and the
    demo endpoints (`functions/api/demo/`), which other sessions own.

## Empty, loading and error states

13. **fixed (#594).** Engine tables show "Failed to load" plus the raw error text and no way to try again
    (`engine/frontend/src/components/DataTable.tsx`); Property OS says what could not load and offers Retry
    (`StaleBanner`).
14. **fixed (#594).** The retry button for a failed load says "Retry" (StaleBanner, 53 screens) or "Try again"
    (`AirbnbListingPicker.tsx`, `CategoryAccessEditor.tsx`, `SupplyChainEngine.tsx`) or is an inline link
    (`owners/shared.tsx`, `units/UnitCleaning.tsx`). ("Try again" on a failed payout is a different action and stays.)
15. **fixed (#594).** Load errors with no retry at all: Notifications list (`NotificationsPage.tsx`), record history
    (`RecordHistory.tsx`), a user's access (`permissions/UserAccess.tsx`).
16. **fixed (#594).** "Loading..." with three dots in `NotificationBell.tsx`, `RecordHistory.tsx`, `StatementDetailPage.tsx`;
    everywhere else "Loading…".
17. **fixed (#594).** StaleBanner's Retry is a hand-made 30px button (`DataState.tsx`), below the touch size and unlike every
    other button.

## Status badges

18. **fixed (#603).** "Sub-unit" is shown in the warning colour (`UnitsPage.tsx`); it is a fact about the unit, not a
    problem, so neutral.
19. Engine screens keep their own badge component (`engine/frontend/src/components/Badge.tsx`); its colours follow the
    same meanings but not the same tokens. Left: replacing it touches hundreds of engine files.

## Table toolbars, page headers, tabs

20. Every Property OS list on `DataTable` has the same toolbar in the same order (Filter, Views, Columns, Export).
    Payouts and Statements sit under the Owners header as tabs, and the field app pages use their own compact header
    by design. Nothing to change.

## Phone (375px)

21. No screen scrolls sideways. **fixed (#609):** controls under 32px tall on the Units tree (row edit / add icons,
    `UnitsPage.tsx`), the Reviews star filter (`reviews/ReviewsOverview.tsx`), Automations wanted / not wanted toggles
    (`AutomationsPage.tsx`) and the Dashboard "Open operations →" links.
    Now: `.hit-target` (`src/styles/tokens.css`) gives a small control a 44px tap area on touch phones without changing
    its look; used by `LinkAction` (every "… →" card link), the Units tree buttons, the calendar popover's Close, the
    status filter's clear, the check-in time save and the report's Reset. The star filter rows are 36px tall on phones
    (a 44px area would overlap the next row).
22. **fixed (#609).** Four private on/off switches looked different for the same meaning: Automations green, the
    rest black, and in dark mode the white knob disappeared on the light "on" track. Now one `Switch`
    (`src/components/Switch.tsx`): ink when on, card-coloured knob, 44px tap area on phones. Used by Automations,
    Settings, Category access and Reviews (AI draft replies).

## One copy, not three (owner, 3 Nov 2026: "one change applies everywhere")

Property OS (`src/`, `functions/`) and the supply-chain engine (`engine/frontend`) are two separate builds; the engine
is shown inside Property OS in a frame. What now has ONE implementation that every place imports:

| What | The one copy | Who uses it |
| --- | --- | --- |
| Date and time shapes (2026/11/03, 11/03, 2026/11/03 14:06, 14:06) | `engine/frontend/src/vendor/shared/format.ts` (`fmtDate`, `fmtDayMonth`, `fmtDateTime`, `fmtTime`), pinned by the engine's `format.date.canonical.test.ts` | engine screens and PDFs; Property OS screens through `src/lib/format.ts`; the server through `functions/_lib/format.ts` |
| Money with sen (RM 1,234.56) | same file (`fmtSen`) | engine; `src/lib/format.ts` `rm()`; `functions/_lib/format.ts` `rmText()`, which replaced 15 hand-typed `RM ${(x / 100).toLocaleString(...)}` strings in audit summaries, notices, payout and refund messages, the letterhead and booking money |
| Form dialog frame (focus, Escape, backdrop, keep-open when dirty) | `DialogFrame` in `src/components/Modal.tsx` (#593) | every Property OS form dialog |
| Form dialog layout (title, sub line, scrolling body, pinned Cancel / action footer) | `Modal` and `FormModal` in `src/components/Modal.tsx` | 24 files importing it, plus the local shells that used to draw their own: Expenses, Maintenance catalog, Dashboard, Contracts, owners (form), units (CentreModal), owner expense entry, calendar (price / block), OpsModal (maintenance, cleaning) |
| Couldn't load / Retry | `StaleBanner` (`src/components/DataState.tsx`, #594); engine lists: `engine/frontend/src/conts/TableLoadError.tsx` | 65 Property OS files; every engine list |
| Spreadsheet formula guard on CSV exports | `csvSafe` in `engine/frontend/src/vendor/shared/format.ts` (batch 7) | Property OS exports, server CSVs, and the engine's CSV, which had no guard at all before |
| On/off switch | `Switch` (`src/components/Switch.tsx`, #609) | Automations, Settings, Category access, Reviews |
| Record header field ("DO NUMBER / DO-2611-004") | `Meta` (`src/components/Card.tsx`) | the 10 document pages that each had their own copy |
| Form field group (small caps title over a 2-column grid) | `FormSection` (`src/components/Card.tsx`) | Customers, Suppliers, 3PL companies |
| Report block on a card | `SectionCard` (`src/components/Card.tsx`) | Unit P&L, Yearly report |

A shared module only stays shared if a change to it reaches every build. Until batch 7 it did not: the Property OS,
preview and scheduled-job deploys watched fixed path lists and CI skipped `engine/`, so an edit to the engine format
module would have changed the engine alone. Those four workflows now watch it, and `scripts/checks/shared-paths.mjs`
fails if Property OS imports any engine file they do not watch.

Still twice, and why:

- **Buttons, badges, tables and toolbars, empty states, page headers between Property OS and the engine.** The engine's
  are Houzs's components on Houzs's Tailwind design system (`engine/frontend/src/components/*`, `vendor/design-system`);
  Property OS's are on its own tokens (`tokens.css`). Merging them means rewriting about a thousand engine files and
  would end the engine's ability to take Houzs fixes file by file (CLAUDE.md). What is shared instead: the formats above,
  the theme (the engine follows Property OS's light/dark through `engine/frontend/src/conts/embed.ts`), and the same
  wording and order rules (this audit). Within each build there is one copy of each.
- **Two `Segmented` controls in Property OS** (`components/Metric.tsx`, `components/ops/OpsUi.tsx`): not a duplicate.
  The first picks a value (and turns into a picker on phones); the second is a tab strip that swaps the whole view.
- **The booking drawer's `CentreModal`** (`components/booking/BookingDrawer.tsx`): its children carry their own body and
  footer (`CentreFooter`), a different contract from `Modal`. It already shares `DialogFrame`; folding it in needs its
  nine callers changed, left for a later pass.
- **Employees' form section** (`workers/EmployeesTab.tsx`): a ruled heading with a note, a different look from
  `FormSection` on purpose.
- **Owner statement PDF dates** (`src/lib/statementPdf.ts`): runs under `node --test`, which cannot import the
  extensionless format module; it prints the same shape (2026/09/30) with its own one-liner.
- **Print preview / PDF modals** and the **SO edit vs Submit VO** screens: another session is unifying them.
- **Owner portal and Owner B** (`OwnerPortalPage.tsx`, `ownerB/`, `functions/api/owner/`, `src/lib/portalI18n.ts`) and
  the demo endpoints (`functions/api/demo/`): other sessions own them; they still format some dates and money themselves.
