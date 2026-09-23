-- Purchase Orders, ported from 2990's SCM (`purchase_orders` + line items). Core priced
-- document: header + lines, status flow SUBMITTED -> PARTIALLY_RECEIVED -> RECEIVED / CANCELLED.
-- Money is integer sen (2990 stores _centi; same minor unit, renamed to Conts's _sen).
-- Deferred to later tiers (kept off the line for now): sofa specials (divan/leg/gap/custom),
-- material bindings, MRP/SO linkage, variants. Receiving fills received_qty via GRN (Tier 1 next).
-- REVERSAL: DROP TABLE purchase_order_lines; DROP TABLE purchase_orders;
set local search_path = pos;

CREATE TABLE purchase_orders (
  id             TEXT PRIMARY KEY,
  po_number      TEXT NOT NULL,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(id),
  status         TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  po_date        TEXT NOT NULL,
  expected_at    TEXT,
  warehouse_id   TEXT REFERENCES warehouses(id),
  currency       TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen   INTEGER NOT NULL DEFAULT 0,
  tax_sen        INTEGER NOT NULL DEFAULT 0,
  total_sen      INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  submitted_at   TEXT,
  received_at    TEXT,
  cancelled_at   TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (po_number)
);

CREATE TABLE purchase_order_lines (
  id                TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  item_code         TEXT NOT NULL,
  description       TEXT NOT NULL,
  uom               TEXT NOT NULL DEFAULT 'UNIT',
  qty               INTEGER NOT NULL DEFAULT 0,
  unit_price_sen    INTEGER NOT NULL DEFAULT 0,
  discount_sen      INTEGER NOT NULL DEFAULT 0,
  line_total_sen    INTEGER NOT NULL DEFAULT 0,
  received_qty      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT
);

CREATE INDEX idx_po_status ON purchase_orders (status);
CREATE INDEX idx_po_supplier ON purchase_orders (supplier_id);
CREATE INDEX idx_po_lines_po ON purchase_order_lines (purchase_order_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
