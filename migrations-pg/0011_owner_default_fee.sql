-- Owner-level default management fee.
--
-- A management operator can set one fee on an OWNER that applies to all of that
-- owner's units, unless a unit sets its own fee on its contract (Link unit). The
-- unit's own contract fee always wins; this column is the fallback used when a
-- unit has none, ahead of the system default of 25%.
--
-- NULL means "no owner default set" — the behaviour before this migration.
--
-- APPLY TO PROD: migrations do NOT auto-run on deploy. Run
--   node scripts/migrate-pg.mjs --env-file=.dev.vars.production
-- (dry-run first) after this ships. Until it runs, the owner PATCH and the
-- /owners/:id/pnl endpoint that read this column will error in prod.
--
-- REVERSAL: ALTER TABLE owners DROP COLUMN default_management_fee_pct;
set local search_path = pos;

ALTER TABLE owners
  ADD COLUMN default_management_fee_pct DOUBLE PRECISION
  CHECK (default_management_fee_pct IS NULL OR default_management_fee_pct BETWEEN 0 AND 100);
