-- Purchase Invoices, ported from 2990's SCM (`purchase_invoices` + items). Bills against a
-- GRN's accepted lines (marks the GRN line's invoiced_qty). Status POSTED ->
-- PARTIALLY_PAID -> PAID / CANCELLED; payments are applied later by Payment Vouchers.
-- Money integer sen. REVERSAL: DROP TABLE purchase_invoice_lines; DROP TABLE purchase_invoices;
set local search_path = pos;

CREATE TABLE purchase_invoices (
  id                   TEXT PRIMARY KEY,
  invoice_number       TEXT NOT NULL,
  supplier_invoice_ref TEXT,
  supplier_id          TEXT NOT NULL REFERENCES suppliers(id),
  purchase_order_id    TEXT REFERENCES purchase_orders(id),
  grn_id               TEXT REFERENCES goods_receipts(id),
  invoice_date         TEXT NOT NULL,
  due_date             TEXT,
  currency             TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen         INTEGER NOT NULL DEFAULT 0,
  tax_sen              INTEGER NOT NULL DEFAULT 0,
  total_sen            INTEGER NOT NULL DEFAULT 0,
  paid_sen             INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','PARTIALLY_PAID','PAID','CANCELLED')),
  notes                TEXT,
  posted_at            TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (invoice_number)
);

CREATE TABLE purchase_invoice_lines (
  id                  TEXT PRIMARY KEY,
  purchase_invoice_id TEXT NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  grn_line_id         TEXT REFERENCES goods_receipt_lines(id),
  line_no             INTEGER NOT NULL,
  item_code           TEXT NOT NULL,
  description         TEXT NOT NULL,
  uom                 TEXT NOT NULL DEFAULT 'UNIT',
  qty                 INTEGER NOT NULL DEFAULT 0,
  unit_price_sen      INTEGER NOT NULL DEFAULT 0,
  line_total_sen      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_pi_status ON purchase_invoices (status);
CREATE INDEX idx_pi_supplier ON purchase_invoices (supplier_id);
CREATE INDEX idx_pi_grn ON purchase_invoices (grn_id);
CREATE INDEX idx_pi_lines_pi ON purchase_invoice_lines (purchase_invoice_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
