-- A unit's own prices take effect from a date (owner, 30 Oct 2026): basic clean, deep clean and maintenance items.
-- The list prices have been dated since 0127; a unit's own figure had no date, so changing it changed every job not
-- yet finished, whatever its day. A job now takes the unit's own price in force on the job's day.
--
--   unit_service_prices.effective_from  the day the figures apply from. Existing rows are "from the start", so no job
--                                       changes price. A row with both figures empty means "the list price from then on".
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- The code checks the column exists, so it can be deployed before or after this runs.
--
-- REVERSAL (loses every dated price, scheduled or already in force; only "from the start" rows stay): delete from unit_service_prices where effective_from <> '2000-01-01';
--   alter table unit_service_prices drop constraint unit_service_prices_pkey;
--   alter table unit_service_prices add primary key (unit_id, item_id);
--   alter table unit_service_prices drop column effective_from;
set local search_path = pos;

alter table unit_service_prices add column if not exists effective_from text not null default '2000-01-01'
  check (effective_from ~ '^\d{4}-\d{2}-\d{2}$');
alter table unit_service_prices drop constraint if exists unit_service_prices_pkey;
alter table unit_service_prices add primary key (unit_id, item_id, effective_from);
