# Split permission areas, part 2

Follows part 1 (`2026-11-12-split-permission-areas.md`, PR #899, migrations 0304 to 0306, live on production).
Part 2 covers what part 1 left: Dream Crafter's pages, Finance by menu part, Mail, and two Conts leftovers. Most of
it needs the supply chain engine, and the engine research (12 Nov 2026) shows very different costs per area, so
part 2 ships in four steps, cheapest and safest first. Each step is its own PR; nobody's access changes on the day
any step ships.

## How a split reaches the engine (all engine steps)

Property OS sends each person's levels in the signed sign-on (`functions/_lib/scmEngine.ts` `ENGINE_AREAS`); the
engine parses them in `engine/backend/src/conts/access.ts` and turns them into page levels and permission keys.

- **New sub-areas are optional in the parse, and a missing one takes its parent's level** (not none). Old stored
  role rows (`conts_access:<role>`) and sign-ons from code that has not shipped yet then keep today's access.
  Required keys would refuse everyone's sign-on (401, `sso.ts:105-106`).
- **Full everywhere gets `*`** (`sso.ts:65-86`), which opens every page. `isFullEverywhere` must also require every
  new sub-area to be Full, or a person with Full on Projects and None on Defects would still see Defects.
- Every person's access fingerprint changes once, so each gets a new `Conts: staff <hash>` role on next sign-on.
  Harmless; old roles are left as they are today.
- Property OS side, as in part 1: new areas, menu keys, a migration copying the parent's rows.

## Step 2a: Property OS only

| Change | Why |
|---|---|
| Dream Crafter HR gets its own area in a Dream Crafter category | The page shares `hr`, and the Dream Crafter side closes the HR category, so Dream Crafter-only staff can never be given it |
| Owner statement close, Lock income, Lock deductions, Lock O2 and Unlock a step move from the Finance category to Units | The page is in the Units menu; same move and pins as Deductions in 0306 |

## Step 2b: engine, small

| Change | Engine work |
|---|---|
| **Production** gets its own box (production orders, SKU composition, draft delivery) | Page key `scm.procurement.production` already exists and guards `/production-orders/*` (`scm/index.ts:1074`). Add optional `scProduction`, override that page after the Procurement prefix (`access.ts:70`), count it for `scm.access` and `isFullEverywhere` |
| **Mail** stays one box | View or Edit opens Mail Center, Full opens Mailboxes; the engine already separates them (`mail_center.read` / `.manage`). Check first whether Mailboxes opens at all for Conts roles: it sits behind the engine's `team` page and needs `users.read`, which Conts roles never get |

Known limit: a person with Production but no Procurement cannot load the supplier list or "from sales order" (other
areas' endpoints). Same as part 1's rule: they need Procurement View too, or those reads get shared.

## Step 2c: engine, medium

| Area | Boxes | Engine work | Limit |
|---|---|---|---|
| Service cases | Cases · Quality metrics · Case settings · My cases | Optional `serviceMetrics`, `serviceSettings`, `serviceMyCases`; page keys `service_cases.metrics` / `.settings` exist; My cases needs a key; route checks on `/metrics*`, `/settings`, `/lookups` writes, `/my-cases`; front-end gates in `ServiceCases.tsx` and `App.tsx:552-565` | `/summary` and `/lookups/:kind` are shared by the list and the other pages |
| Projects | Projects · Defects · Handover checklists · Finances · Project settings | Map to `projects.list` / `.finances` / `.maintenance`, add `projects.defects` and `projects.handover`; route checks on `/beta/defect-queue`, `/handover-templates`, settings writes; re-point `App.tsx:589-592` | **Calendar cannot be its own box**: it reads the same `/api/beta/board` as the Projects list. It stays with Projects |

## Step 2d: engine, large (design first)

**Finance by menu part** (To approve, Suppliers, Rental bills, Billing, Collections, Bank, Reports, Setup, both
companies) needs a redesign of the ledger's permission keys, not just new areas:

- The ledger's finer powers are global keys (`scm.payment_voucher.create/.write/.check/.approve/.post/.cancel`,
  `engine/backend/src/conts/ledger-access.ts:13-22`). Most Reports and Setup **reads** need `.post`, which only
  Full holds. So "View on Reports" cannot be said today, and "Full on Reports" would also open posting in Suppliers
  and Billing.
- `/scm/accounting` is one screen whose tabs (journal entries, general ledger, trial balance, P&L, balance sheet,
  both ageing tabs, item groups) span four parts; it needs tab-aware gating.
- Not yet billed and Outstanding follow Invoices and payments (`scInvoices`), not the Ledger; official receipts and
  merchant recon are open paths shared with Sales.

Needs its own design: per-part permission keys, a method-aware path guard, the tab-to-part table, and a decision on
what each level means per part. Separate PR after 2a to 2c.

## Found on the way (not fixed by this plan)

- **Service cases: No access is enforced only in the engine's screens.** `routes/assr.ts` lets anyone with a
  company grant read the list, a case and My cases (`requireServiceCaseAccess`, `assr.ts:122-130,153-157,194-204`).
- **Mail Center: No access is enforced only in the screens.** `/api/mail-center` has no area check at its mount
  (`index.ts:517`); reads are limited to the person's own mailboxes.
- **Production database:** the 12 Nov migration run lists `0182_conts_menu_categories` and `0299_conts_staff_manager`
  as still pending.

## Open questions

1. Order: 2a, 2b, 2c, then the 2d design. Or another order?
2. Projects Calendar: keep it with Projects (one box), as the engine cannot separate it?
3. Mail: one box (View/Edit = Mail Center, Full = Mailboxes) or two?
4. The two "enforced only in the screens" gaps: fix inside 2c (service cases) and 2b (mail), or a separate PR?
