-- Transport masters, ported from 2990's SCM. `drivers` is 1:1 with 2990; `vehicles` is a
-- bounded master for the delivery fleet (Houzs's Lorry pages; full schema not in the base
-- snapshot). Delivery orders reference a driver + vehicle by name today. Flags are 0/1.
-- REVERSAL: DROP TABLE vehicles; DROP TABLE drivers;
set local search_path = pos;

CREATE TABLE drivers (
  id          TEXT PRIMARY KEY,
  driver_code TEXT NOT NULL,
  name        TEXT NOT NULL,
  phone       TEXT,
  ic_number   TEXT,
  vehicle     TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (driver_code)
);

CREATE TABLE vehicles (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  plate             TEXT,
  vehicle_type      TEXT,
  capacity_m3_milli INTEGER NOT NULL DEFAULT 0,
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (code)
);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
