-- Delivery Residence Rules, ported from 2990's SCM (delivery_residence_rules) — owner-maintained
-- per-building-type delivery config the TMS scheduler reads (service duration, delivery time
-- window, lift-booking / registration flags). Config CRUD only; nothing here schedules.
-- building_type is unique. Times are HH:MM text. REVERSAL: DROP TABLE delivery_residence_rules;
set local search_path = pos;

CREATE TABLE delivery_residence_rules (
  id                       TEXT PRIMARY KEY,
  building_type            TEXT NOT NULL,
  service_duration_minutes INTEGER NOT NULL DEFAULT 0,
  earliest_delivery_time   TEXT,
  latest_delivery_time     TEXT,
  requires_lift_booking    INTEGER NOT NULL DEFAULT 0,
  requires_registration    INTEGER NOT NULL DEFAULT 0,
  notes                    TEXT,
  is_active                INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (building_type)
);

CREATE INDEX idx_resrule_active ON delivery_residence_rules (is_active);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
