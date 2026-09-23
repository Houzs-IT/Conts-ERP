-- Driver Leave, ported from 2990's SCM (driver_leave) — dated leave periods per driver, so
-- the delivery planner knows who is unavailable. 2990 also tracks helper leave; Conts has no
-- helpers module, so this is drivers-only. REVERSAL: DROP TABLE driver_leave;
set local search_path = pos;

CREATE TABLE driver_leave (
  id          TEXT PRIMARY KEY,
  driver_id   TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_driver_leave_driver ON driver_leave (driver_id);
CREATE INDEX idx_driver_leave_dates ON driver_leave (start_date, end_date);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
