-- Channel connections made from Conts through Channex's Channel API (replacing the deprecated embedded
-- /channels screen): which unit is connected to which OTA listing. Booking.com and Agoda: one Channex
-- channel per unit, identified by the OTA's Hotel ID. Airbnb: one Channex channel per Airbnb account,
-- shared by every unit mapped on it; each unit is one listing mapping on that channel.
-- REVERSAL: DROP TABLE channex_channels;
set local search_path = pos;

CREATE TABLE channex_channels (
  id                 TEXT PRIMARY KEY,
  unit_id            TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  ota                TEXT NOT NULL CHECK (ota IN ('airbnb','booking_com','agoda')),
  channex_channel_id TEXT NOT NULL,
  channex_mapping_id TEXT,                    -- Airbnb: the listing's mapping on the shared channel
  external_id        TEXT NOT NULL,           -- Booking.com / Agoda Hotel ID, or the Airbnb listing id
  external_room      TEXT,
  external_rate      TEXT,
  title              TEXT,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  UNIQUE (unit_id, ota)
);
CREATE INDEX idx_chx_channels_channel ON channex_channels (channex_channel_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
