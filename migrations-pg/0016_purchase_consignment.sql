-- Purchase Consignment Orders, ported from 2990's SCM consignment module. Structurally a
-- purchase order for consigned stock (you settle only what you use; unsold is returned).
-- Core order ported here; consignment receives + returns are a follow-up sub-slice.
-- Money integer sen. REVERSAL: DROP TABLE pc_order_lines; DROP TABLE pc_orders;
set local search_path = pos;

CREATE TABLE pc_orders (
  id           TEXT PRIMARY KEY,
  pc_number    TEXT NOT NULL,
  supplier_id  TEXT NOT NULL REFERENCES suppliers(id),
  status       TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  pc_date      TEXT NOT NULL,
  expected_at  TEXT,
  warehouse_id TEXT REFERENCES warehouses(id),
  currency     TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen INTEGER NOT NULL DEFAULT 0,
  tax_sen      INTEGER NOT NULL DEFAULT 0,
  total_sen    INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  submitted_at TEXT,
  cancelled_at TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (pc_number)
);

CREATE TABLE pc_order_lines (
  id             TEXT PRIMARY KEY,
  pc_order_id    TEXT NOT NULL REFERENCES pc_orders(id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  item_code      TEXT NOT NULL,
  description    TEXT NOT NULL,
  uom            TEXT NOT NULL DEFAULT 'UNIT',
  qty            INTEGER NOT NULL DEFAULT 0,
  unit_price_sen INTEGER NOT NULL DEFAULT 0,
  discount_sen   INTEGER NOT NULL DEFAULT 0,
  line_total_sen INTEGER NOT NULL DEFAULT 0,
  received_qty   INTEGER NOT NULL DEFAULT 0,
  notes          TEXT
);

CREATE INDEX idx_pc_status ON pc_orders (status);
CREATE INDEX idx_pc_supplier ON pc_orders (supplier_id);
CREATE INDEX idx_pc_lines_pc ON pc_order_lines (pc_order_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
