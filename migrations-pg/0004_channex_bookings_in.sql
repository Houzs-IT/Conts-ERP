-- Links a reservation back to the Channex booking it came from, so a later revision of the
-- same OTA booking (modified or cancelled) updates the existing row instead of duplicating it.
-- Null for reservations created locally (direct, manual OTA entry, blocks, owner stays).
-- REVERSAL: DROP INDEX pos.reservations_channex_booking_id_key; ALTER TABLE reservations DROP COLUMN channex_booking_id;
set local search_path = pos;

ALTER TABLE reservations ADD COLUMN channex_booking_id TEXT;
CREATE UNIQUE INDEX reservations_channex_booking_id_key ON reservations(channex_booking_id) WHERE channex_booking_id IS NOT NULL;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
