-- Each booking site gets its own price: besides the unit's direct rate plan (channex_rate_plan_id), a
-- linked unit has one Channex rate plan per OTA, mapped to that OTA's channel and fed that OTA's price
-- (base rate + the channel's uplift, weekend multiplier, or the night's own override).
-- REVERSAL: ALTER TABLE units DROP COLUMN channex_rate_plan_airbnb, DROP COLUMN channex_rate_plan_booking_com, DROP COLUMN channex_rate_plan_agoda;
set local search_path = pos;

ALTER TABLE units ADD COLUMN channex_rate_plan_airbnb TEXT;
ALTER TABLE units ADD COLUMN channex_rate_plan_booking_com TEXT;
ALTER TABLE units ADD COLUMN channex_rate_plan_agoda TEXT;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
