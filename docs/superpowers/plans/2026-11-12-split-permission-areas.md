# Split every permission area to one box per page

Goal: in Users and roles > Permissions, every menu page gets its own View / Edit / Full box, like Calendar,
Reservations and Guests (migration 0304). Reports stays one tick for all five report pages (owner's choice,
migration 0305). On the day it ships, nobody's access changes.

## How a split works (same as 0304)

1. `functions/_lib/access.ts` `AREAS`: the old area becomes one area per page, in the same group.
2. Endpoints move to the new area by first path segment (`api: [...]`) or by `ROUTE_AREAS` for a sub-path.
3. `src/lib/navigation.ts`: each menu item points at its own area.
4. Buttons inside pages that check `mayWork` / `maySee` / `levelAt` on the old key check the page's own key.
5. A migration copies every stored row of the old area to each new area, at every scope.
6. Tests that list every area (`src/lib/access.test.mjs`) and the API checks that set levels get the new keys.

## The one new mechanism: an endpoint shared by sibling pages

Many endpoints are used by two or three pages of the same group (table below). Picking one owner would lock
the other page's users out of their own screen. Proposal: a `ROUTE_AREAS` entry can name several areas, and the
request gets the **highest** level the person has in any of them.

```text
routeArea(method, path)
  entry = ROUTE_AREAS match
  if entry.area is a list
    return the area in the list where the person's level is highest
```

Effect: whoever can use Cleaning or Maintenance can use the service price list both pages show. That is what
they can do today, since both pages are one Operations box now.

## Phase 1: Property OS only (no engine change)

| Group | New boxes (key) | Owns | Shared with a sibling (any-of) |
|---|---|---|---|
| Operations | Today (`today`), Cleaning (`cleaning`), Maintenance (`maintenance`) | `/operations/day` · `housekeeping`, `tasks` · `maintenance` | `/operations/service-prices`, `/operations/job-*`, `/housekeeping/guest-left`, `/housekeeping/price-raise` |
| Units | Units (`properties`), Scheduled changes (`scheduledChanges`), Agent to let (`agentToLet`), Unit settings (`unitSettings`) | `units`, `access-credentials` · `/units/scheduled-changes` · `lettings` · `unit-layout-types`, `unit-bed-sizes`, writes to `contract-types` | `properties` (Units, Unit settings), `lettings` (Units, Agent to let), `/housekeeping/unit-prices` (Units, Scheduled changes) |
| Units | Owners (`owners`), Contracts (`contracts`) | `owners` · `contracts` | `/units/:id/contract` (Units, Contracts) |
| Units | Deductions (`deductions`, moved from the Finance category) | `/finance/deductions` | `POST /expenses`, `DELETE /expenses/:id` (Finance, Deductions) |

As built (12 Nov 2026): `operations` stays as the Today box, so the notices, the daily digest and field app
access that follow it keep working; Owner B stays on Performance (open question 2). A shared endpoint lists only
pages split from the same old box, so nobody gains a page on day one. Migration 0306.
| Growth | Pricing (`pricing`), Reviews (`reviews`) | `pricing`, `rates` · `reviews` | none |

Kept as they are: Dashboard, Reports (one tick), Calendar / Reservations / Guests, Employees, Messages,
Automations, Owner statement close, Airbnb reconciliation, Lock income, Unlock a step, System. Finance moves to
phase 2 (below).

Key choice for `operations`, `properties`, `owners`, `pricing`, `finance`: the old key stays on the page that
holds most of its endpoints (Units keeps `properties`, Owners keeps `owners`, Pricing keeps `pricing`, Finance
keeps `finance`); `operations` retires and Today, Cleaning, Maintenance are new. That keeps the server changes
small: 16 server and 7 client references to `operations`, about 3 client references each for the others.

## Phase 2: needs the engine (separate PR, later)

The engine gets levels in a signed sign-on (`functions/_lib/scmEngine.ts` `ENGINE_AREAS`) and its parser
refuses an unknown or missing area (`engine/backend/src/conts/access.ts` `AREA_PAGE`, `sso.ts:106`). These
splits change both sides at once:

### Finance: one box per menu part (owner, 12 Nov 2026)

Finance is not split by company: The Conts and Dream Crafter are one company with one set of books
(docs/finance/FINANCE-SOP.md, "一本总账，分部门"), and the same finance staff handle both. One Finance stays in both
sidebars, under Both companies.

The Finance and Ledger boxes merge. Finance gets one box per menu part, and each box covers that part's own
pages and its ledger screens together. Airbnb reconciliation folds into Bank (owner, 12 Nov 2026), which ends the
"closed until management opens it" rule of migration 0258 for it. Owner statement close, Lock income and Unlock a
step keep their own boxes.

| Box | Own pages | Ledger screens |
|---|---|---|
| To approve | Approvals | Payment requests, Limit requests, Petty cash |
| Suppliers | none | AP invoices, Payment vouchers, Supplier ledger, Creditor ageing |
| Rental bills | Accounts payable, Utility bills | none |
| Billing | none | Deposit invoices, Other debtors, Credit / debit notes, Not yet billed, E-invoice |
| Collections | none | Money received, Official receipts, Debtors, Customer ledger, Outstanding, Debtor ageing |
| Bank | Airbnb reconciliation | Daily bank, Bank reconciliation, Merchant recon |
| Reports | Unit P&L | Profit and loss, Balance sheet, Trial balance, General ledger, Journal entries, Rental unit costs, Spending by department, Renovation projects, AI usage |
| Setup | none | Chart of accounts, Item group accounts, Ledger setup |

Day one: each box gets the higher of the person's old Finance and Ledger level for the pages it covers, per
part: a part with only ledger screens copies Ledger, a part with only own pages copies Finance, a mixed part
(To approve, Reports) needs a rule (open question 3). The engine must accept the 8 keys in place of `ledger`
and check each ledger screen against its part.

Endpoints still on `finance` from pages outside the Finance menu (Deductions in Units; owner statements and
payouts on Owners; the owner portal's `owner` routes) need a home box (open question 4).

| Group | Split | Pages |
|---|---|---|
| Service cases | Cases, Quality metrics, Case settings, My cases | 4 |
| Projects | Projects, Calendar, Defects, Handover checklists, Finances, Project settings | 6 |
| Supply chain | Production off Procurement | 3 |
| Mail | Mail Center, Mailboxes | 2 |

## Files (phase 1)

| File | Change |
|---|---|
| `functions/_lib/access.ts` | ✏️ new areas; `ROUTE_AREAS` sub-paths; `area` may be a list (highest level wins) |
| `src/lib/navigation.ts` | ✏️ each item its own area |
| pages and handlers checking `operations`, `properties`, `owners`, `pricing`, `finance` | ✏️ check the page's own key |
| `migrations-pg/0306_split_areas.sql` | 🆕 copy each old area's rows to its new areas |
| `src/lib/access.test.mjs`, `scripts/api-checks/*.mjs` | ✏️ new keys; one test for the any-of rule |

## Risks

- **Deploy order:** run 0304, 0305, 0306 before the code, or people with explicit old-area rows lose pages.
- **Any-of widens nothing on day one** (all siblings start equal), but later a person given only Cleaning can
  change service prices Maintenance also uses. Accepted: it is the same price list.
- **Missed button checks** show a button the server then refuses (403). The server stays the gate; the API
  checks in CI cover the main writes.

## Rollback

`DELETE FROM pos.access_rules WHERE updated_by = 'migration 0306';` and revert the code. Old area rows are never
deleted, so the old code reads them unchanged.

## Open questions

1. Phase 1 as one PR, or one PR per group (Operations first)?
2. Owner B: its own box (`ownerB`) as above, or keep it on the Reports > Performance box?
3. Finance mixed parts (To approve, Reports, Bank): on day one, take the higher of the old levels, or the lower?
   For Bank, the higher opens Airbnb reconciliation to everyone with Ledger access; the lower closes the bank
   screens for everyone not yet given Airbnb reconciliation.
4. Deductions, owner statements and payouts, and the owner portal routes: which Finance box covers them?
