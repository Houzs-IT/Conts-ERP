-- Delivery Zones, ported from 2990's SCM (delivery_zone_postcodes) — the company-editable
-- postcode-prefix -> area-zone map. prefix_start..prefix_end are the FIRST TWO digits of a
-- Malaysian postcode (00..99). Ships EMPTY; until customised, classification falls back to
-- the in-code default map (see functions/_lib/delivery-zones.ts), so the map always resolves.
-- The auto-propose scheduler (needs Google Maps) is NOT ported here — this is the map admin
-- only. REVERSAL: DROP TABLE delivery_zone_postcodes;
set local search_path = pos;

CREATE TABLE delivery_zone_postcodes (
  id           TEXT PRIMARY KEY,
  zone         TEXT NOT NULL,
  prefix_start INTEGER NOT NULL,
  prefix_end   INTEGER NOT NULL,
  label        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_dzone_prefix ON delivery_zone_postcodes (prefix_start);
CREATE INDEX idx_dzone_active ON delivery_zone_postcodes (is_active);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
