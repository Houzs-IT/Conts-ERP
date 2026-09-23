-- Delivery scheduling (the Transportation planning cluster), ported from 2990's SCM
-- delivery-planning as a MANUAL scheduler (no Google Maps auto-routing). ONE row per sales
-- order to be delivered; the five nav pages are views over it: DP Orders (the queue), Delivery
-- Date Arrangement (planned_date), Delivery Time Arrangement (time_slot / planned_time),
-- Delivery Planning (assign driver/vehicle/sequence for a day), Last Mile Delivery (dispatch ->
-- delivered). REVERSAL: DROP TABLE delivery_schedule;
set local search_path = pos;

CREATE TABLE delivery_schedule (
  id             TEXT PRIMARY KEY,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  so_doc_no      TEXT NOT NULL,
  customer_name  TEXT NOT NULL,
  address        TEXT,
  zone           TEXT,
  planned_date   TEXT,
  time_slot      TEXT CHECK (time_slot IN ('MORNING','AFTERNOON','EVENING')),
  planned_time   TEXT,
  driver_id      TEXT REFERENCES drivers(id),
  vehicle_id     TEXT REFERENCES vehicles(id),
  sequence_no    INTEGER,
  status         TEXT NOT NULL DEFAULT 'UNPLANNED'
                 CHECK (status IN ('UNPLANNED','SCHEDULED','DISPATCHED','DELIVERED','CANCELLED')),
  notes          TEXT,
  dispatched_at  TEXT,
  delivered_at   TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (sales_order_id)
);

CREATE INDEX idx_dsched_status ON delivery_schedule (status);
CREATE INDEX idx_dsched_date ON delivery_schedule (planned_date);
CREATE INDEX idx_dsched_driver ON delivery_schedule (driver_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
