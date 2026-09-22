-- Which Channex listing a unit is linked to, if any. All three or none — set together by
-- PATCH /api/units/:id/channex-mapping. A unit with no mapping is simply not synced.
-- REVERSAL: ALTER TABLE units DROP COLUMN channex_property_id, DROP COLUMN channex_room_type_id, DROP COLUMN channex_rate_plan_id;
set local search_path = pos;

ALTER TABLE units ADD COLUMN channex_property_id  TEXT;
ALTER TABLE units ADD COLUMN channex_room_type_id  TEXT;
ALTER TABLE units ADD COLUMN channex_rate_plan_id  TEXT;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
