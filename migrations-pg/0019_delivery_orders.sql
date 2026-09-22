-- Delivery Orders, ported from 2990's SCM. Delivers a sales order's lines (fills the SO
-- line's delivered_qty and, when fully delivered, advances the SO to DELIVERED). Status
-- LOADED -> DISPATCHED -> IN_TRANSIT -> SIGNED -> DELIVERED / INVOICED / CANCELLED. Cancel
-- reverses. Money integer sen. POD image / signature capture deferred.
-- REVERSAL: DROP TABLE delivery_order_lines; DROP TABLE delivery_orders;
set local search_path = pos;

CREATE TABLE delivery_orders (
  id                   TEXT PRIMARY KEY,
  do_number            TEXT NOT NULL,
  sales_order_id       TEXT REFERENCES sales_orders(id),
  customer_name        TEXT NOT NULL,
  do_date              TEXT NOT NULL,
  expected_delivery_at TEXT,
  status               TEXT NOT NULL DEFAULT 'LOADED'
                       CHECK (status IN ('LOADED','DISPATCHED','IN_TRANSIT','SIGNED','DELIVERED','INVOICED','CANCELLED')),
  driver_name          TEXT,
  vehicle              TEXT,
  address1             TEXT,
  city                 TEXT,
  state                TEXT,
  postcode             TEXT,
  phone                TEXT,
  notes                TEXT,
  dispatched_at        TEXT,
  delivered_at         TEXT,
  cancelled_at         TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (do_number)
);

CREATE TABLE delivery_order_lines (
  id                  TEXT PRIMARY KEY,
  delivery_order_id   TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  sales_order_line_id TEXT REFERENCES sales_order_lines(id),
  line_no             INTEGER NOT NULL,
  item_code           TEXT NOT NULL,
  description         TEXT NOT NULL,
  uom                 TEXT NOT NULL DEFAULT 'UNIT',
  qty                 INTEGER NOT NULL DEFAULT 0,
  unit_price_sen      INTEGER NOT NULL DEFAULT 0,
  line_total_sen      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_do_status ON delivery_orders (status);
CREATE INDEX idx_do_so ON delivery_orders (sales_order_id);
CREATE INDEX idx_do_lines_do ON delivery_order_lines (delivery_order_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
