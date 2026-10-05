-- A unit's standing minimum stay. Airbnb listings carry their own default minimum nights, and a full
-- sync sends a minimum stay for every night: without a unit-level default it would reset an imported
-- listing to one night. A night's own minimum stay (unit_restrictions) still wins.
-- REVERSAL: ALTER TABLE units DROP COLUMN min_stay;
set local search_path = pos;

ALTER TABLE units ADD COLUMN min_stay INTEGER NOT NULL DEFAULT 1 CHECK (min_stay BETWEEN 1 AND 60);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
