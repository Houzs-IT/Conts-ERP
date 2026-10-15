# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One responsive web app (React SPA on Cloudflare Pages). The mobile role apps are mobile web, not native.

## Users

Three audiences, given equal weight (owner's answer, 15 Oct 2026). Each gets first-class treatment in its own app rather than a cut-down view of another's.

- **Office staff** (roles `management`, `operations_manager`, `operations_staff`, `finance_admin`) on desktop, all day: run bookings, units, rates, housekeeping, maintenance, owner statements and payouts, supply chain documents and renovation projects.
- **Field crew** (roles `housekeeper`, `technician`) on phones, on site: work through today's task list, capture photo evidence, keep working with patchy signal.
- **Property owners** (role `owner`) in the owner portal, desktop and mobile: read statements, payouts and property health, approve requests, without phoning the office.

Role scoping is enforced on the server: `MASTER_ROLES` gate management actions, `isFieldRole` limits field accounts to their screens, owners see only their own units.

## Product Purpose

The Conts ERP (repo name Property OS) is the back office for one Malaysian company group, Kuala Lumpur and Petaling Jaya context. It is one ERP covering three businesses (owner's answer, 15 Oct 2026):

1. **Short-term rental management.** The company manages other people's units and lists them on Airbnb, Booking.com and Agoda through Channex. Owners, buildings, units, bookings, rates, housekeeping, maintenance, owner statements, payouts.
2. **Supply chain.** Sales orders, purchase orders, goods receipts, delivery orders, invoices, warehouse, run by `engine/` (Conts's own copy of the Houzs supply chain) and shown inside the app.
3. **Renovation and full-home customisation** (Dream Crafter / The Conts). Quotation with revisions, sales order, variation orders, purchase orders per trade, project stages from design to handover, close-out. Design: `docs/superpowers/specs/2026-10-09-renovation-flow-design.md`.

Success: owners are paid correctly and can see why; staff run the day from one place; renovation projects move from quote to handover with every PO, payment and stage traceable.

## Positioning

The owner-of-record core: State, Building, Unit, Owner as the structural spine, with owner statements in two models (guaranteed rental return, or gross minus management fee minus split expenses), combined payouts across an owner's units, and every deduction traceable to its source. Most rental tools are built for a host who owns their own listings; this one is built for a manager holding a portfolio for many owners. Operations feed the money loop directly (maintenance work order to unit expense to owner statement).

Conts is not a booking marketplace and does not compete with Airbnb for guests. Commodity capabilities (pricing, accounting, check-in, payments) are bought and integrated; only the owner-of-record core is built natively. Source: `docs/COMPETITIVE-POSITIONING.md`.

## Operating Context

- Channel manager: Channex (live on production since 2 Oct 2026), per-channel rate plans, webhook sync, double-booking prevention.
- Owners receive statements and payouts in MYR; tourism tax and SST are future statement lines.
- Field crew work from phones on site; photo gates and offline sync are part of their flow.
- Renovation work is subcontracted per trade for now; the owner's team previously tracked projects in Notion.
- Staging preview: https://staging-preview.theconts-os.pages.dev. Production: https://theconts-os.pages.dev. The owner checks every change on staging before it merges.

## Capabilities and Constraints

- Backend: Cloudflare Pages Functions (`functions/api/**`), Supabase Postgres schema `pos` through Hyperdrive. Supply chain engine: Cloudflare Worker `conts-scm-engine`, schemas `scm` and `public`, on the free Workers plan (some saves are slow).
- Frontend: React 18, Vite, Tailwind 4, lucide-react icons, react-router.
- Design handoff files in the repo: `tokens.css` / `tokens.json` (theme), `routes.json`, `permissions.json`, `components.md`, `copy.md`, `BUTTONS.md`, and the `.dc.html` design and spec documents.
- Engine screens keep Houzs's structure, recoloured to The Conts palette at build time (`engine/frontend/conts/palette.mjs`); change as little as possible there except renovation files.
- Not confirmed as binding (documented in `copy.md` / `components.md`, owner did not select them on 15 Oct 2026): the closed status vocabulary, WCAG AA contrast on badges, and planned Malay and Simplified Chinese with 30% text expansion. Treat as current conventions, not commitments.
- Open: the shared UI font (Houzs ships Tahoma, Hookka ships IBM Plex Sans, the brand guide requires one); the original vector logo (logo positions are placeholders).

## Brand Commitments

- **The Conts Digital Brand Guide v1.0 (16 Sep 2026) is binding** (owner's answer, 15 Oct 2026).
- Gold is brand and selection only. It never means success, warning or error.
- A brand change is a token change: `tokens.css` is the one file it touches.
- Voice (from `copy.md`): sentence case, direct, specific, calm, accountable. Verb first for actions, short nouns for navigation.

## Evidence on Hand

- Designs: `The Conts Desktop.dc.html`, `The Conts Mobile.dc.html`, `The Conts Design System.dc.html`, `The Conts Frontend Spec.dc.html`.
- All figures in designs and seed data are placeholders. Production still holds seeded example data until the owner clears it. No real customer, testimonial or performance figures exist; do not invent any.
- Logo: provisional only; the vector original is still owed by the client.

## Product Principles

1. Owners must be able to trust every number: each figure on a statement traces to a booking, expense or deduction with category, date, amount and reference.
2. Three audiences, three first-class apps: staff, field crew and owners each get screens built for their situation, not a shrunk version of someone else's.
3. One ERP, one company: rental, supply chain and renovation share one sign-in, one navigation and one brand.
4. Buy the commodity, build the core: integrate vendors for pricing, accounting, check-in and payments; spend design effort on the owner-of-record core and the renovation flow.
5. Financial data is scoped by role in the server response, never only hidden in the UI.
