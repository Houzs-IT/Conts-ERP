-- Stock movements ledger, ported from 2990's SCM inventory. On-hand is the running sum of
-- qty_delta per item + warehouse. This first cut tracks QUANTITY only; FIFO cost layers and
-- automatic GRN/DO wiring are a follow-up. Manual adjustments post here directly.
-- REVERSAL: DROP TABLE stock_movements;
set local search_path = pos;

CREATE TABLE stock_movements (
  id            TEXT PRIMARY KEY,
  item_code     TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
  qty_delta     INTEGER NOT NULL,                     -- signed: + in, - out
  movement_type TEXT NOT NULL CHECK (movement_type IN ('RECEIPT','ISSUE','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','RETURN','STOCK_TAKE')),
  ref_type      TEXT,                                 -- e.g. 'GRN','DO','ADJ'
  ref_id        TEXT,
  note          TEXT,
  moved_at      TEXT NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_stockmv_item_wh ON stock_movements (item_code, warehouse_id);
CREATE INDEX idx_stockmv_moved ON stock_movements (moved_at);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
