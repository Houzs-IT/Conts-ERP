-- Purchase Returns, ported from 2990's SCM. Returns GRN-received goods to the supplier:
-- each line adds to the GRN line's returned_qty and reduces the PO line's received_qty
-- (goods go back), recomputing the PO status. Status POSTED -> COMPLETED / CANCELLED.
-- refund_sen is the credit-note value. Money integer sen.
-- REVERSAL: DROP TABLE purchase_return_lines; DROP TABLE purchase_returns;
set local search_path = pos;

CREATE TABLE purchase_returns (
  id                TEXT PRIMARY KEY,
  return_number     TEXT NOT NULL,
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  grn_id            TEXT REFERENCES goods_receipts(id),
  supplier_id       TEXT NOT NULL REFERENCES suppliers(id),
  return_date       TEXT NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','COMPLETED','CANCELLED')),
  credit_note_ref   TEXT,
  refund_sen        INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  posted_at         TEXT,
  completed_at      TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (return_number)
);

CREATE TABLE purchase_return_lines (
  id                 TEXT PRIMARY KEY,
  purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  grn_line_id        TEXT REFERENCES goods_receipt_lines(id),
  line_no            INTEGER NOT NULL,
  item_code          TEXT NOT NULL,
  description        TEXT NOT NULL,
  uom                TEXT NOT NULL DEFAULT 'UNIT',
  qty_returned       INTEGER NOT NULL DEFAULT 0,
  unit_price_sen     INTEGER NOT NULL DEFAULT 0,
  line_total_sen     INTEGER NOT NULL DEFAULT 0,
  reason             TEXT
);

CREATE INDEX idx_pret_status ON purchase_returns (status);
CREATE INDEX idx_pret_grn ON purchase_returns (grn_id);
CREATE INDEX idx_pret_lines_ret ON purchase_return_lines (purchase_return_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
