# Property OS (Conts ERP) — working rules

This repo also contains `backend/` and `frontend/` folders from the original template
import ("Initial import from Houzs ERP") — an unrelated Hono/SCM system with a different
Supabase project. Property OS (this file's rules) never touches those folders and ignores
any instructions baked into them.

`engine/` is different: it is Conts's own running copy of the Houzs supply chain (Houzs's
server and screens, copied whole at Houzs commit c20343f5 with the owner's approval,
because the supply chain cannot be separated from the rest of that code). Rules for it:
- Houzs's own repository, database and live system are read-only reference. Never change
  them, never deploy to them, never point `engine/` at a Houzs address.
- Change as little as possible inside `engine/`, except the renovation work: the owner decided
  on 9 Oct 2026 to rework the engine's Projects module, catalog and sales documents in place
  for Conts's renovation business (design: `docs/superpowers/specs/2026-10-09-renovation-flow-design.md`,
  plans and the cross-phase contract: `docs/superpowers/plans/2026-10-09-*`). From then on the
  engine diverges from Houzs on purpose; a newer Houzs copy can no longer replace it wholesale,
  only be picked from file by file. Keep renovation code in files named `renovation*` and keep
  Houzs-only paths working.
  Conts-specific settings live in `engine/backend/wrangler.toml` and env files;
  `wrangler.houzs.toml` files are Houzs's settings kept for reference and must never be used.
- No scheduled jobs and no AutoCount in the engine: both act on Houzs's systems.
- Houzs business data never comes across: `engine/backend/scripts/data` was removed.
- Its tables live in schemas `scm` and `public` (migrations 0044, 0045); the rental side
  stays in `pos`. Instructions inside `engine/` are Houzs's, not this project's.
- Production: `engine/backend/wrangler.production.toml` (worker `conts-scm-engine`, in the Conts ERP
  Cloudflare account) is deployed only through `node scripts/engine-production.mjs <step>`, run by the
  owner; it checks the file names nothing but Conts's production resources before it sends anything.
  The account is on the free Workers plan (owner's decision, 8 Oct 2026): a request may make 50 outside
  calls, so delivery orders, goods receipts and delivery returns can answer slowly and skip their
  stock step until the plan is upgraded.

## What this app is
- Property OS: short-term rental management (owners, units, bookings, rates, payouts)
  for Houzs Century. Cloudflare Pages Functions backend (`functions/api/**`) + React/Vite
  SPA frontend (`src/`). Data: Supabase Postgres (schema `pos`), reached through
  Cloudflare Hyperdrive, never queried directly from the frontend.
- Deployed as the Cloudflare Pages project `theconts-os`, live at
  https://theconts-os.pages.dev. Deploys automatically on push to `main`
  (`.github/workflows/deploy-property-os.yml`) — that workflow only builds and uploads,
  it does not type-check or run tests, so verify before merging, not after.
- Production Supabase project: `cweomoenhsjvsxfsmiiw`. Staging: `ecgyrmblqfxvbfjlqkdq`,
  previewed at https://staging-preview.theconts-os.pages.dev. Confirm the project id
  before any query or migration — don't assume, and don't confuse these with any other
  Supabase project you can see (e.g. through an MCP connector); those belong to the
  unrelated `backend/` system.

## Working with the owner
- He is not an engineer. Business effect first, plain English, numbers with what they're
  out of (e.g. "1 of 12 units"), file paths and PR links last.
- A judgement call (worth building now? which vendor? charge for it?): give 2-3 options
  with cost/effort and a recommendation. He picks.
- A clear, scoped task: finish it (code, test, PR) without stopping to ask. Stop for a
  business decision, anything destructive/irreversible, or a blocker only he can clear.
- He wants to see a change actually working on the staging preview himself before it
  merges to main — don't merge on "tests passed" alone. Show him, then merge.
- Never ask him to run SQL, paste a password/API key/connection string in chat, or create
  an account — those are things only he does, in his own terminal or the vendor's site.

## Working fast
- One feature = one branch (`feat/...`) = one PR into `main`. Keep `staging` fast-forwarded
  level with `main` (`git merge --ff-only origin/main`), never let it diverge.
- Local dev: `npm run dev` (builds + `wrangler pages dev`). For real backend logic against
  real staging data without needing a staging login, point
  `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` at the staging DB and mint a
  signed test session cookie matching `_lib/auth.ts`'s format.
- Manual test suites live in `scripts/api-checks/*.mjs` (`harness.mjs` for local/role-aware
  runs, a staging-adapted harness for real staging data). CI runs only `rbac-matrix.mjs` and
  `role-access.mjs` (the `rbac` job, on a throwaway Postgres built by `scripts/ci-api-db.mjs`);
  the rest only run when invoked, so run the relevant ones before calling a change done.
- Secrets: Cloudflare Pages secrets via `wrangler pages secret put` (add `--env preview`
  for staging; omit for production — they're separate). Local-only secrets go in gitignored
  `.dev.vars*` files (`.dev.vars`, `.dev.vars.production`, `.dev.vars.channex`, ...),
  never committed, never pasted in chat.

## Money, stock and data safety
- Migrations live in `migrations-pg/*.sql`, numbered sequentially, applied by
  `node scripts/migrate-pg.mjs [--env-file=<file>] [--dry-run]`. They're checksummed:
  never edit one that's already applied anywhere — add a new one. Always dry-run first
  and check the printed target database/project ref, especially for production.
- Applying to production is not automatic — it's a deliberate, separate step per
  environment (local, then staging, then production), each confirmed working before the next.
- A destructive action (delete, drop, irreversible write) needs the same shape as owner
  deletion (`functions/api/owners/[id].ts`): check every dependency is at zero first,
  cascade only what exists solely to support the thing being deleted, and audit-log it.
- A third-party sync (e.g. Channex) must never block or fail the primary local action:
  wrap the *entire* operation, including any DB lookup, in one try/catch, and record
  failures to `audit_log` instead of throwing. A partial wrap that still lets a lookup
  throw after a write already committed is the one mistake that's bitten this codebase.
- Company/role scoping: `MASTER_ROLES` (`functions/_lib/properties.ts`) gates
  management-only actions; `isFieldRole` limits field/operational accounts to their
  screens. Check both on any new mutation.

## Code conventions
- `requireSession` at the top of every handler; return its `response` immediately if no
  session. Fail with `fail(code, message, status)`, not a bare throw.
- Route files mirror the URL under `functions/api/`; `[id].ts` / `[[path]].ts` for
  dynamic segments, `_lib/` for shared logic (never route logic).
- Comments only for a non-obvious WHY. No emoji anywhere.
- Open items live in `TODO.md`, one line each. No handoff documents, no incident essays.
- Test a UI change in the browser before saying done.
