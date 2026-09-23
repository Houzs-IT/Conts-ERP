-- Fleet Health, ported from 2990's SCM fleet-maintenance (the CORE — 2990's compliance vault,
-- work orders, maintenance plans and component tracking are deep layers not ported). A
-- per-vehicle service / repair / inspection log with cost and the next-due reminder.
-- Money integer sen. REVERSAL: DROP TABLE fleet_maintenance_records;
set local search_path = pos;

CREATE TABLE fleet_maintenance_records (
  id            TEXT PRIMARY KEY,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  record_type   TEXT NOT NULL DEFAULT 'SERVICE'
                CHECK (record_type IN ('SERVICE','REPAIR','INSPECTION','TYRE','ROAD_TAX','INSURANCE','OTHER')),
  service_date  TEXT NOT NULL,
  odometer_km   INTEGER,
  cost_sen      INTEGER NOT NULL DEFAULT 0,
  next_due_date TEXT,
  next_due_km   INTEGER,
  status        TEXT NOT NULL DEFAULT 'DONE' CHECK (status IN ('SCHEDULED','DONE')),
  vendor        TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_fleetmt_vehicle ON fleet_maintenance_records (vehicle_id);
CREATE INDEX idx_fleetmt_due ON fleet_maintenance_records (next_due_date);
CREATE INDEX idx_fleetmt_date ON fleet_maintenance_records (service_date);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
