# Conts Property OS — Handoff

_Last updated: 2026-09-22 (evening — parallel build wave + migration runbook)_

Conts is the back office for a **short-term-rental / homestay management operator**
in Malaysia (manages other owners' units, lists across OTAs). **Not a booking platform.**
See `docs/COMPETITIVE-POSITIONING.md` and `docs/DATE-FORMAT.md`.

> ⚠️ **No PR-triggered CI on this repo.** The only workflow is `deploy-property-os.yml`
> on push to `main`, so **merging a PR deploys it straight to prod** (`erp.theconts.com`).
> Verify before merging; there is no CI gate to catch it after.

## Live on prod (merged this wave — all schema-free, no migration)

| PR | What shipped |
| --- | --- |
| #9  | Scrollable 30-day multi-calendar |
| #10 | `docs/DATE-FORMAT.md` + `docs/COMPETITIVE-POSITIONING.md` + this handoff |
| #12 | Date-format hardening — 8 `format.ts` helpers; fixed the UTC "today" off-by-one |
| #13 | Operations — manual cleaning create/edit + maintenance cost→owner-statement callout |
| #15 | Owners — manual statement adjustment + owner-portal per-unit/per-line drill-down |
| #17 | Housekeeping — POD photo upload, Start/End duration, POD gallery, checkout+next-check-in deadline, building/unit grouping |
| #21 | UI — responsive mobile drawer shell; Contracts/Users dates via `date()`; real inventory unit count |

## Held migration batch — DONE + verified, NOT merged (each 500s in prod until its migration is applied)

Every PR below adds a `migrations-pg/*.sql` and its endpoints read/write the new columns.
Merging before the migration is applied makes those endpoints 500 (frontend falls back to
stale data). Hold them until the migration pass below.

| PR | Module | Migration (current name) | Notes |
| --- | --- | --- | --- |
| #14 | Properties — GRR per month/year, editable unit state, multi-layer sub-units | `0006_unit_layers_grr_period` | — |
| #16 | Expenses — month switcher + Total→L1→L2→L3 drill-down | `0006_expense_hierarchy` | also edits `schema.sql` |
| #18 | Maintenance — SKU catalog + preset selling price + Start/End duration | `0008_maintenance_skus` | **merge before #20** |
| #20 | Maintenance — parts stock + request-to-exchange | `0009_maintenance_stock` | **stacked on #18**; stock table references the SKU table |
| #19 | Owner profile (`#/owners/:id`) — per-unit P&L + expenses + owner-level default fee | `0009_owner_default_fee` | adds `owners.default_management_fee_pct` |
| #23 | Housekeeping — cleaner roster (internal vs outsourced) + auto-assign rules | `0007_housekeeping_cleaner_roster` | recovered from auto-closed #22 |
| #11 | PriceLabs dynamic-pricing intake (DRAFT, flag OFF) | `0006_pricelabs_mapping` | needs owner decision + `PRICELABS_WEBHOOK_SECRET`; renumber if adopted |

**Migration numbering:** several share a number (0006×3, 0009×2) because each branch picked "next"
independently. `scripts/migrate-pg.mjs` sorts by full filename and applies each once, so duplicate
*numbers* do not collide (the filenames differ) and the one real dependency — #18's
`maintenance_skus` before #20's `maintenance_stock` — is satisfied by `0008 < 0009`. Renumbering to a
clean 0006–0011 is a tidy-up to do while integrating, not a correctness requirement.

## Migration pass — runbook (OWNER-gated: needs the prod DB admin URL; secrets never via chat)

`scripts/migrate-pg.mjs` applies `migrations-pg/*.sql` once each (checksummed in a
`public.pos_migrations` table) **and** rotates the API role's password when `POS_APP_PASSWORD`
is given — so the migration pass and the outstanding password rotation are one operation.

1. **Create `.dev.vars.production`** in the repo root (git-ignored — do NOT commit):
   - `DATABASE_URL="postgres://postgres:<admin-pw>@<host>/postgres"` — the admin/`postgres` connection to the **prod** Supabase DB.
   - `POS_APP_PASSWORD="<a new strong password>"` — the new password for the `pos_app` runtime role (this performs the rotation).
2. **Integrate the held PRs** so all pending `*.sql` are present in one tree (rebase them onto a scratch integration branch; resolve the `App.tsx` route conflicts across #18/#19/#23; optionally renumber to 0006–0011). Do NOT merge to `main` yet.
3. **Dry-run against prod** — confirm the target and the pending list:
   `node scripts/migrate-pg.mjs --env-file=.dev.vars.production --dry-run`
   (prints `Target database:` + each `pending:` file — read it before applying).
4. **Apply:** `node scripts/migrate-pg.mjs --env-file=.dev.vars.production`
   (applies pending migrations in a transaction each, then sets the `pos_app` password).
5. **Update the deployment secret** so the running Worker uses the new `pos_app` password (Cloudflare Pages env / the API's `DATABASE_URL`). If the *admin* `postgres` password itself was the leaked one, rotate that in the Supabase dashboard too.
6. **Merge the held PRs to `main`** (in order; #18 before #20) → auto-deploy. Columns now exist, so the new endpoints work instead of 500-ing.
7. **Verify live** on `erp.theconts.com` (Properties GRR month/year, Expenses drill-down, Maintenance SKU catalog + start/end, Owner profile P&L, Housekeeping cleaner roster).

> The `pos_app` password rotation in step 4 supersedes the standalone "rotate the leaked DB
> password" task — doing the migration pass closes it.

## Owner decisions still open

1. **Product master (Maintenance #20).** `inventory_items` is a per-unit furniture register, not a
   cross-unit product/parts master, so parts stock currently lives on the maintenance SKU
   (`stock_on_hand`) with a nullable `inventory_item_id` hook. **(A)** keep this interim, or
   **(B)** build a real cross-unit product master (separate module) — undecided.
2. **PriceLabs (#11).** Adopt dynamic pricing or not; if yes, provide `PRICELABS_WEBHOOK_SECRET`
   via Cloudflare env (never chat) and confirm the real payload shape in `functions/_lib/pricelabs.ts`.

## Deferred (noted, not built)

- Linking an owner **from the unit side** + per-unit maintenance/fee edits on the unit page
  (belongs to the Properties/#14 track; kept out of the Owner-profile PR to avoid file collisions).
- `BookingsPage.tsx:78` `nowStamp` still computes a UTC datetime (out of the #12 scope) — fold in
  with a future CalendarPage date pass.

## Operator build priorities (see `docs/COMPETITIVE-POSITIONING.md`)

1. PriceLabs (dynamic pricing) → 2. Xero export (keep native statement math, push journal lines) →
3. Guest-comms automations + AI reply via Houzs Connect → 4. Self-check-in + foreign-guest
registration (Chekin/Enso) → 5. Direct-booking + Stripe (last/optional — not a platform).
