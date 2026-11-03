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
   (`owners/Costs.tsx`), Start payout run (`PayoutsPage.tsx`). The shared `Modal` (34 dialogs) did not move focus in
   or back. In every one, a stray click on the dimmed backdrop threw away a half-filled form.
   Now one frame, `DialogFrame` in `src/components/Modal.tsx`: focus goes to the first field and back on close, Tab
   stays inside, Escape and the backdrop close it, and once something has been typed they ask "Discard your
   changes?" first. Also used by `AddUtilityBill`, `ApprovalBanner`, `BookingDrawer` (CentreModal), `GuestDocuments`,
   `CalendarModals`, `OpsUi` (OpsModal), `ContractsPage`, `DashboardPage`, `owners/ExpenseEntry`, `owners/OwnerMoney`,
   `owners/shared`, `StatementsPage`, `units/shared`.
2. **fixed (#593).** The approval and void-document reason boxes were `bg-white` (`ApprovalBanner.tsx`,
   `GuestDocuments.tsx`); now the card surface like every other field.
3. **open.** The field app's full-screen repair sheets (`FieldRepairsPage.tsx`) and the photo viewers
   (`Attachments.tsx`, `ItSupportPage.tsx`) keep their own frames: they are full-screen views, not forms.

## Buttons

4. **fixed (batch 3).** New IT request form puts Send left of Cancel and on the left (`ItSupportPage.tsx`); everywhere else it is
   Cancel then the main action, on the right.
5. **fixed (batch 3).** Advance row edit shows Save before Cancel (`workers/AdvancesTab.tsx`).
6. **fixed (batch 3).** Export says five different things: "Export" (every table toolbar), "Export to Excel"
   (`finance/UtilityListing.tsx`, `UnitPnlPage.tsx`, `YearlyReportPage.tsx`), "Export Excel"
   (`OwnerOverallReportPage.tsx`), "Download CSV" (`ExpensesPage.tsx`), "Export all units" (`UnitsPage.tsx`).
   All page buttons now say "Export" with the download icon. "Download CSV" stays: it is the action button inside the
   expense report dialog, where naming the file is the point. "Export all units" on Units stays too: the list view also
   has the table's own Export (the rows shown), and the header one (every unit, every field) must not read the same.
7. **fixed (batch 3).** Title Case where the rest is sentence case: "Add Employee" (`workers/EmployeesTab.tsx`,
   `workers/DcEmployeesTab.tsx`), the "IT Support" page title (`ItSupportPage.tsx`). "Add employee" fixed; "IT Support"
   kept on purpose: it is the module's name, the same in the menu and in the sister systems (Hookka, Houzs Century).
8. **fixed (batch 3).** "Discard" (throw away unsaved edits) is a different button style on each of 14 screens (tertiary,
   secondary, ghost, plain): `CleaningSetup`, `MaintenancePage`, `ServicePrices`, `SettingsPage`, `units/UnitCleaning`,
   `settings/AgreementTemplate`, `GuestsPage`, `BookingDrawer`, `CategoryAccessEditor`, `permissions/*`.

## Money and numbers

9. **fixed (batch 3).** Service price ranges print the upper end without the thousands comma: "RM 1,000.00 – 1500.00"
   (`ServicePrices.tsx`).
10. **fixed (batch 3).** Headline money tiles drop the sen ("RM 12,450") on Owners (`OwnersPage.tsx`) and the Overall unit
    report (`OwnerOverallReportPage.tsx`), while the engine shows every amount in full. Owner's request: RM with sen
    wherever money is shown. Nightly prices on the calendar stay whole ringgit (they are set in whole ringgit).
    The same rule was dropping sen in 66 more places (`rm(x, { cents: false })`: Dashboard, Portfolio, Analytics,
    Statements, Reservations, Accounting, Guests, Maintenance, Cleaning, Contracts, supplier and customer credit limits,
    invoice and order totals). All now show sen; copy.md's money table and `MoneyText`'s default say so. Whole ringgit is
    kept only for nightly rates in the calendar and pricing grids, and compact amounts only on chart axes.
11. Not changed on purpose: payroll and advance exports (`workers/PayrollTab.tsx`, `workers/AdvancesTab.tsx`) write
    plain `1234.50` so Excel reads them as numbers.

## Dates

12. **decision.** The engine prints dates as `2026/11/03` (`engine/frontend/src/vendor/shared/format.ts`, Houzs's
    numeric-date rule of 25 Sep 2026, also on its PDFs); Property OS prints `3 Nov 2026` (`src/lib/format.ts`,
    `docs/DATE-FORMAT.md`). One helper changes it either way, but it reverses a recorded ruling, so it is the owner's
    pick. Times already match (24-hour, Malaysian time).

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

18. **fixed (batch 3).** "Sub-unit" is shown in the warning colour (`UnitsPage.tsx`); it is a fact about the unit, not a
    problem, so neutral.
19. Engine screens keep their own badge component (`engine/frontend/src/components/Badge.tsx`); its colours follow the
    same meanings but not the same tokens. Left: replacing it touches hundreds of engine files.

## Table toolbars, page headers, tabs

20. Every Property OS list on `DataTable` has the same toolbar in the same order (Filter, Views, Columns, Export).
    Payouts and Statements sit under the Owners header as tabs, and the field app pages use their own compact header
    by design. Nothing to change.

## Phone (375px)

21. No screen scrolls sideways. **open:** controls under 32px tall on the Units tree (row edit / add icons,
    `UnitsPage.tsx`), the Reviews star filter (`reviews/ReviewsOverview.tsx`), Automations wanted / not wanted toggles
    (`AutomationsPage.tsx`) and the Dashboard "Open operations →" links.
