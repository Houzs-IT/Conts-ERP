-- A unit's own Friday/Saturday price. Listings carry their own weekend price (e.g. RM 112 weekdays,
-- RM 180 weekends), which a single weekend multiplier for every unit cannot express. NULL keeps the old
-- behaviour: base rate times the standard weekend multiplier.
-- REVERSAL: ALTER TABLE units DROP COLUMN weekend_rate;
set local search_path = pos;

ALTER TABLE units ADD COLUMN weekend_rate INTEGER CHECK (weekend_rate IS NULL OR weekend_rate > 0);   -- sen

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
