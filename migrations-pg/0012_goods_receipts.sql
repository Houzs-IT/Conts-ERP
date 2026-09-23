-- Goods Received Notes (GRN), ported from 2990's SCM (`grns` + `grn_items`). Receives
-- against a purchase order: each line fills the PO line's received_qty and advances the
-- PO status (SUBMITTED -> PARTIALLY_RECEIVED -> RECEIVED). Money integer sen. Furniture
-- specials deferred. Cancelling a GRN reverses the received_qty it added.
-- REVERSAL: DROP TABLE goods_receipt_lines; DROP TABLE goods_receipts;
set local search_path = pos;

CREATE TABLE goods_receipts (
  id                TEXT PRIMARY KEY,
  grn_number        TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  supplier_id       TEXT NOT NULL REFERENCES suppliers(id),
  received_at       TEXT NOT NULL,
  delivery_note_ref TEXT,
  status            TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CLOSED','CANCELLED')),
  notes             TEXT,
  currency          TEXT NOT NULL DEFAULT 'MYR',
  subtotal_sen      INTEGER NOT NULL DEFAULT 0,
  tax_sen           INTEGER NOT NULL DEFAULT 0,
  total_sen         INTEGER NOT NULL DEFAULT 0,
  posted_at         TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (grn_number)
);

CREATE TABLE goods_receipt_lines (
  id                     TEXT PRIMARY KEY,
  grn_id                 TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id TEXT REFERENCES purchase_order_lines(id),
  line_no                INTEGER NOT NULL,
  item_code              TEXT NOT NULL,
  description            TEXT NOT NULL,
  uom                    TEXT NOT NULL DEFAULT 'UNIT',
  qty_received           INTEGER NOT NULL DEFAULT 0,
  qty_accepted           INTEGER NOT NULL DEFAULT 0,
  qty_rejected           INTEGER NOT NULL DEFAULT 0,
  rejection_reason       TEXT,
  unit_price_sen         INTEGER NOT NULL DEFAULT 0,
  line_total_sen         INTEGER NOT NULL DEFAULT 0,
  invoiced_qty           INTEGER NOT NULL DEFAULT 0,
  returned_qty           INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT
);

CREATE INDEX idx_grn_po ON goods_receipts (purchase_order_id);
CREATE INDEX idx_grn_status ON goods_receipts (status);
CREATE INDEX idx_grn_lines_grn ON goods_receipt_lines (grn_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
