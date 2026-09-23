-- Sales Invoices (AR), ported from 2990's SCM. Bills a delivery order's lines; marks the DO
-- (and its SO) INVOICED. Status SENT -> PARTIALLY_PAID -> PAID / CANCELLED; receipts post to
-- paid_sen. Money integer sen. REVERSAL: DROP TABLE sales_invoice_lines; DROP TABLE sales_invoices;
set local search_path = pos;

CREATE TABLE sales_invoices (
  id                TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL,
  delivery_order_id TEXT REFERENCES delivery_orders(id),
  sales_order_id    TEXT REFERENCES sales_orders(id),
  customer_name     TEXT NOT NULL,
  invoice_date      TEXT NOT NULL,
  due_date          TEXT,
  currency          TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen      INTEGER NOT NULL DEFAULT 0,
  tax_sen           INTEGER NOT NULL DEFAULT 0,
  total_sen         INTEGER NOT NULL DEFAULT 0,
  paid_sen          INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED')),
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (invoice_number)
);

CREATE TABLE sales_invoice_lines (
  id                TEXT PRIMARY KEY,
  sales_invoice_id  TEXT NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  item_code         TEXT NOT NULL,
  description       TEXT NOT NULL,
  uom               TEXT NOT NULL DEFAULT 'UNIT',
  qty               INTEGER NOT NULL DEFAULT 0,
  unit_price_sen    INTEGER NOT NULL DEFAULT 0,
  line_total_sen    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_si_status ON sales_invoices (status);
CREATE INDEX idx_si_do ON sales_invoices (delivery_order_id);
CREATE INDEX idx_si_lines_si ON sales_invoice_lines (sales_invoice_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
