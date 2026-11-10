-- Cleaning priced by bed size (owner, 6 Nov 2026): a price per bed size (King, Queen, ...) entered once, and a unit's
-- clean costs the sum of (bed size price x quantity) from its Beds and mattresses. Replaces the price by unit Type.
--
--   service_items.by_bed   1 = the item's price grid is the bed size list. Its dated rows in service_item_prices use
--                          layout 'bed:<size key>', plus 'no_beds' for a unit with no beds recorded (or a job with no
--                          unit). Until the first of those rows is in force, jobs keep the old price by unit Type, so
--                          switching the item over changes no price by itself.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- The code checks the column exists, so it can be deployed before or after this runs. A column on an existing table:
-- no new grant needed.
--
-- REVERSAL (loses the bed size prices; jobs go back to the price by unit Type):
--   delete from service_item_prices where layout like 'bed:%' or layout = 'no_beds';
--   update service_items set by_bed = 0;
-- Drop the column only together with a redeploy: running workers remember that it exists.
--   alter table service_items drop column by_bed;
set local search_path = pos;

alter table service_items add column if not exists by_bed integer not null default 0 check (by_bed in (0, 1));

update service_items set by_bed = 1 where domain = 'cleaning' and clean_kind is not null and active = 1 and by_layout = 1;
