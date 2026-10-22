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
   only if you work on supply chain, service cases or projects. To run it locally inside the rental app:
   - `engine/backend/.dev.vars` (see its `.dev.vars.example`): the same staging connection line as the root
     `.dev.vars` (one database, the engine uses the `scm` and `public` schemas), the staging Supabase URL and
     service role key, and a random `CONTS_SSO_SECRET`.
   - The root `.dev.vars` gets the three `SCM_ENGINE_*` lines from `.dev.vars.example`, the secret matching
     `CONTS_SSO_SECRET`. `.dev.vars` overrides the `wrangler.toml` addresses only when the server is restarted.
   - `engine/frontend/.env.local`: `VITE_API_URL=http://localhost:5173` and
     `VITE_DEV_API_PROXY_TARGET=http://localhost:8787`. Without `VITE_API_URL` the dev screens call a placeholder address.
   - Start all three (`.claude/launch.json` has them): `npm run dev` (8788); in `engine/backend`,
     `node --env-file=.dev.vars node_modules/wrangler/bin/wrangler.js dev --port 8787` (its own `npm run dev`
     does not pass the database line to wrangler); `npm --prefix engine/frontend run dev -- --port 5173`.
     Supply chain menus in the rental app then open the local engine, signed in.

## Environments

| | Address | Supabase project |
|---|---|---|
| Live | https://erp.theconts.com (also https://theconts-os.pages.dev) | `cweomoenhsjvsxfsmiiw` |
| Staging | https://staging-preview.theconts-os.pages.dev | `ecgyrmblqfxvbfjlqkdq` |

Confirm which database you are pointed at before any query or migration. On staging, a management
account has a "View as" button (bottom right) to see the system as any other account.

The engine has its own pair: worker `conts-scm-engine-staging` with site `theconts-scm` for staging,
worker `conts-scm-engine` with site `theconts-scm-live` for live.

## How work flows

1. One feature is one branch (`feat/...` or `fix/...`) and one pull request into `main`.
2. Test locally, then publish to staging and let Zaim see it working there. He approves on staging
   before anything merges.
3. Every pull request runs CI (`.github/workflows/ci.yml`): type check, build, `npm run check`, and the
   role checks (`rbac-matrix.mjs`, `role-access.mjs`) on a throwaway database. The other checks in
   `scripts/api-checks/` run only when you invoke them, so run the relevant ones yourself, and test a
   screen change in a browser. Merging to `main` deploys Property OS to live automatically; the deploy
   itself checks nothing.
4. Keep the `staging` branch level with `main`.

A pull request that changes several hundred files may not trigger the live deploy (GitHub only looks
at the first 300 changed files for the path filter). Run the "Deploy Property OS" workflow by hand in
that case.

## Rules that matter most

- **Database changes** are numbered files in `migrations-pg/`, applied with `scripts/migrate-pg.mjs`.
  Never edit one that has been applied anywhere: add a new one. Always `--dry-run` first. Each
  environment is a separate, deliberate step (local, then staging, then live). Tell Zaim before adding
  one, so two people do not take the same number.
- **Production database steps and merges to `main` are Zaim's to run.** Prepare them; do not run them.
- **Houzs's own repository, database and live system are read-only.** Never deploy to them and never
  point `engine/` at a Houzs address.
- **Change as little as possible inside `engine/`**, except the renovation work: since 9 Oct 2026 the
  Projects module, catalog and sales documents are reworked in place for Conts's renovation business
  (`docs/superpowers/specs/2026-10-09-renovation-flow-design.md`), so a newer Houzs copy can only be
  picked from file by file. Renovation code goes in files named `renovation*`; other Conts-only code
  lives in `engine/backend/src/conts/` and `engine/frontend/src/conts/`. Keep Houzs-only paths working.
- **The engine goes live when its change merges to `main`.** The "Deploy engine to production" workflow
  (`.github/workflows/deploy-engine-production.yml`) runs `node scripts/engine-production.mjs deploy` and
  `screens`, which check the target before sending anything; by hand, run the same steps. Staging follows
  `staging` and `main` the same way ("Deploy engine to staging"). So a migration the engine reads goes to
  the production database before the merge, never after.
- **A third-party sync (Channex) must never fail the main action.** Wrap the whole operation and record
  failures in `audit_log`.
- **Access.** Every handler starts with `requireSession`. What a role may do comes from the Permissions
  chart (`functions/_lib/access.ts`): use `session.manage`, `mayWork`, `maySee` and `mayRun`, not a
  hard-coded list of role names.
- **Words on screen** follow `docs/VOCABULARY.md` (one idea, one word). `npm run check` fails on a
  banned word. The printed Owner Income Report (`src/pages/OwnerIncomeReportPage.tsx`) copies the
  owner's own sample word for word: do not change its wording.
- **No secrets** in the repository, in chat or in a pull request.

## Things to know before they surprise you

- **Staging is one shared slot.** Whoever publishes last overwrites the other. Say so in the group chat
  when you are using it.
- **The Cloudflare account is on Workers Paid** (billed since 17 Oct 2026, confirmed by finance on
  21 Oct): 10,000 outside calls per request by default, so the free plan's 50-call limit on delivery
  orders, goods receipts, bank reconciliation and statement sending no longer applies.
- **The engine's accounting ledger is switched on for Conts** (owner's decision, 21 Oct 2026; finance
  phase 1, `docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md`). It sits under Finance,
  and only people whose role has the Ledger area (Permissions chart, Finance group) get in: the engine
  key `scm.ledger.use`, which counts only when held outright; the full-access `*` does not include it
  (`engine/backend/src/conts/ledger-access.ts`). Its settings, posting rules and opening balances are on
  Finance > Ledger setup. Nothing dated before the ledger start date posts.
- **Engine list screens cache for about a minute.** A new record may need Refresh.
- **The PriceLabs draft pull request** (#11) is on hold by the owner's decision. Leave it alone.

## Who to ask

- **Zaim**: priorities, staging approval, production steps, the secrets files.
- **Mr Lim**: business decisions (owner statements, AutoCount, company details).
