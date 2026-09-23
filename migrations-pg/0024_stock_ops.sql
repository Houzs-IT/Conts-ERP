-- Stock Transfers + Stock Takes, ported from 2990's SCM. Both post to the stock_movements
-- ledger (0017): a transfer = TRANSFER_OUT(from) + TRANSFER_IN(to); a take posts ADJUSTMENT
-- movements for each counted variance. Money-less (quantities only).
-- REVERSAL: DROP TABLE stock_take_lines; DROP TABLE stock_takes; DROP TABLE stock_transfer_lines; DROP TABLE stock_transfers;
set local search_path = pos;

CREATE TABLE stock_transfers (
  id                TEXT PRIMARY KEY,
  transfer_number   TEXT NOT NULL,
  from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id   TEXT NOT NULL REFERENCES warehouses(id),
  transfer_date     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (transfer_number),
  CONSTRAINT stock_transfers_not_same_wh CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE stock_transfer_lines (
  id                 TEXT PRIMARY KEY,
  stock_transfer_id  TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  line_no            INTEGER NOT NULL,
  item_code          TEXT NOT NULL,
  description        TEXT,
  qty                INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0)
);

CREATE TABLE stock_takes (
  id           TEXT PRIMARY KEY,
  take_number  TEXT NOT NULL,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  take_date    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','POSTED','CANCELLED')),
  notes        TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (take_number)
);

CREATE TABLE stock_take_lines (
  id            TEXT PRIMARY KEY,
  stock_take_id TEXT NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  item_code     TEXT NOT NULL,
  description   TEXT,
  system_qty    INTEGER NOT NULL DEFAULT 0,
  counted_qty   INTEGER,
  variance      INTEGER
);

CREATE INDEX idx_st_transfer_lines ON stock_transfer_lines (stock_transfer_id);
CREATE INDEX idx_st_take_lines ON stock_take_lines (stock_take_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
