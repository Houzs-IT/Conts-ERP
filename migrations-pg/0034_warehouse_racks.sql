-- Racks & Bins, ported from 2990's SCM (warehouse_racks) — the rack/bin LOCATION master
-- inside a warehouse. 2990 also tracks per-rack items + movements (GRN rack-sync); that
-- deep layer is not ported — this is the location master the "Racks & Bins" page manages.
-- REVERSAL: DROP TABLE warehouse_racks;
set local search_path = pos;

CREATE TABLE warehouse_racks (
  id           TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  rack         TEXT NOT NULL,
  position     TEXT,
  status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  reserved     INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (warehouse_id, rack)
);

CREATE INDEX idx_rack_warehouse ON warehouse_racks (warehouse_id);
CREATE INDEX idx_rack_status ON warehouse_racks (status);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
