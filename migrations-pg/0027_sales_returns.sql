-- Sales Returns, ported from 2990's SCM (sell-side twin of Purchase Returns). A customer
-- returns goods that were delivered on a DO: each line reduces the sales-order line's
-- delivered_qty (goods come back) and, when the DO recorded a dispatch warehouse, posts a
-- RETURN +qty movement back into it. Status POSTED -> COMPLETED / CANCELLED. refund_sen is
-- the credit-note value. Money integer sen. Cancelling reverses.
-- REVERSAL: DROP TABLE sales_return_lines; DROP TABLE sales_returns;
--           ALTER TABLE delivery_order_lines DROP COLUMN returned_qty;
set local search_path = pos;

-- Track how much of each delivery line has come back, so the returnable cap is correct
-- across several sales returns (mirrors goods_receipt_lines.returned_qty on the buy side).
ALTER TABLE delivery_order_lines ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0;

CREATE TABLE sales_returns (
  id                TEXT PRIMARY KEY,
  return_number     TEXT NOT NULL,
  sales_order_id    TEXT REFERENCES sales_orders(id),
  delivery_order_id TEXT REFERENCES delivery_orders(id),
  customer_name     TEXT NOT NULL,
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

CREATE TABLE sales_return_lines (
  id                    TEXT PRIMARY KEY,
  sales_return_id       TEXT NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  delivery_order_line_id TEXT REFERENCES delivery_order_lines(id),
  line_no               INTEGER NOT NULL,
  item_code             TEXT NOT NULL,
  description           TEXT NOT NULL,
  uom                   TEXT NOT NULL DEFAULT 'UNIT',
  qty_returned          INTEGER NOT NULL DEFAULT 0,
  unit_price_sen        INTEGER NOT NULL DEFAULT 0,
  line_total_sen        INTEGER NOT NULL DEFAULT 0,
  reason                TEXT
);

CREATE INDEX idx_sret_status ON sales_returns (status);
CREATE INDEX idx_sret_do ON sales_returns (delivery_order_id);
CREATE INDEX idx_sret_lines_ret ON sales_return_lines (sales_return_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
