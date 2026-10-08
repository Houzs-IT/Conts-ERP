# Conts ERP: getting started

For a developer joining the project. The working rules are in `CLAUDE.md` (Claude Code reads it
automatically) and every open item is in `TODO.md`. This file only gets you from a fresh clone to a
first pull request; where it and `CLAUDE.md` disagree, `CLAUDE.md` wins.

## What is in this repository

One repository, two systems that staff see as one:

- **Property OS** (repo root): short-term rental management. Owners, units, bookings, pricing, payouts,
  and Airbnb / Booking.com / Agoda sync through Channex. Cloudflare Pages Functions in `functions/api/`,
  React and Vite screens in `src/`, Supabase Postgres in schema `pos`.
- **Supply chain engine** (`engine/`): a whole copy of Houzs's supply chain, service cases and projects,
  run as Conts's own instance. Its screens are shown inside Property OS in a frame, with one sign-in
  (`functions/_lib/scmEngine.ts` and `engine/backend/src/conts/sso.ts`).

The top-level `backend/` and `frontend/` folders are an old template import. They are not used or
deployed. Do not touch them.

## Set up

1. Clone `hookka-dev/Conts-ERP` and run `npm install` in the repo root.
2. `npm run typecheck` and `npm run build` should both pass before you change anything.
3. `npm run dev` builds and serves it locally. To run against real staging data you need the local
   secrets files: ask Zaim for them directly (USB or a password manager, never chat or email).
   `CLAUDE.md`, "Working fast", explains pointing local dev at the staging database and minting a test
   session.
4. The engine has its own `npm install` in `engine/backend` and in `engine/frontend`. You need those
   only if you work on supply chain, service cases or projects.

## Environments

| | Address | Supabase project |
|---|---|---|
| Live | https://erp.theconts.com | `cweomoenhsjvsxfsmiiw` |
| Staging | https://staging-preview.theconts-os.pages.dev | `ecgyrmblqfxvbfjlqkdq` |

Confirm which database you are pointed at before any query or migration. On staging, a management
account has a "View as" button (bottom right) to see the system as any other account.

The engine has its own pair: worker `conts-scm-engine-staging` with site `theconts-scm` for staging,
worker `conts-scm-engine` with site `theconts-scm-live` for live.

## How work flows

1. One feature is one branch (`feat/...` or `fix/...`) and one pull request into `main`.
2. Test locally, then publish to staging and let Zaim see it working there. He approves on staging
   before anything merges.
3. Merging to `main` deploys Property OS to live automatically. There is no automatic test gate: run
   the relevant checks in `scripts/api-checks/` yourself first, and test a screen change in a browser.
4. Keep the `staging` branch level with `main`.

A pull request that changes several hundred files may not trigger the live deploy (GitHub only looks
at the first 300 changed files for the path filter). Run the "Deploy Property OS" workflow by hand in
that case.

## Rules that matter most

- **Database changes** are numbered files in `migrations-pg/`, applied with `scripts/migrate-pg.mjs`.
  Never edit one that has been applied anywhere: add a new one. Always `--dry-run` first. Tell Zaim
  before adding one, so two people do not take the same number.
- **Production database steps and merges to `main` are Zaim's to run.** Prepare them; do not run them.
- **Houzs's own repository, database and live system are read-only.** Never deploy to them and never
  point `engine/` at a Houzs address.
- **Change as little as possible inside `engine/`**, so a newer Houzs copy can replace it. Conts-only
  code lives in `engine/backend/src/conts/` and `engine/frontend/src/conts/`; a change to a Houzs file
  carries a comment starting "Conts:".
- **The live engine is deployed only through** `node scripts/engine-production.mjs <step>`, which checks
  the target before it sends anything. The staging engine is `npx wrangler deploy` in `engine/backend`.
- **A third-party sync (Channex) must never fail the main action.** Wrap the whole operation and record
  failures in `audit_log`.
- **Access.** Every handler starts with `requireSession`. What a role may do comes from the Permissions
  chart (`functions/_lib/access.ts`): use `session.manage`, `mayWork`, `maySee` and `mayRun`, not a
  hard-coded list of role names.
- **No secrets** in the repository, in chat or in a pull request.

## Things to know before they surprise you

- **Staging is one shared slot.** Whoever publishes last overwrites the other. Say so in the group chat
  when you are using it.
- **The Cloudflare account is on the free Workers plan.** In the engine, delivery orders, goods receipts
  and delivery returns exceed the plan's 50 outside calls per request: they answer slowly and can skip
  the stock deduction. Known and accepted for now (see `TODO.md`).
- **Engine list screens cache for about a minute.** A new record may need Refresh.
- **Old unmerged branches** (`feat/weekend-price`, `feat/airbnb-import`, the PriceLabs draft pull
  request) predate many recent changes and need updating before they will merge cleanly.

## Who to ask

- **Zaim**: priorities, staging approval, production steps, the secrets files.
- **Mr Lim**: business decisions (owner statements, AutoCount, company details).
