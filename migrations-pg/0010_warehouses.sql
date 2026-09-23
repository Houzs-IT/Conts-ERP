-- Warehouse master, ported from 2990's SCM (`warehouses`). Stock lives against a
-- warehouse; exactly one is the default. Racks (bin management) are deferred to the
-- Warehouse-ops tier. Booleans stored as 0/1 (Conts convention).
-- REVERSAL: DROP TABLE warehouses;
set local search_path = pos;

CREATE TABLE warehouses (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  location   TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (code)
);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
