-- Parts stock for the maintenance catalog and a "request to exchange" ledger. A SKU can carry a
-- quantity on hand (the maintenance parts store); raising a job can draw a part from that stock,
-- which decrements the SKU and writes a move row. A move may optionally point at the unit's
-- inventory_items row the part became, linking the draw to the property inventory master.
-- NOTE: inventory_items is a PER-UNIT furniture register, not a cross-unit product master with
-- sellable stock, so the maintenance parts store lives on the SKU itself; inventory_item_id is a
-- forward hook for when a drawn part is installed as a specific unit's item.
-- REVERSAL: DROP TABLE pos.maintenance_stock_moves;
--           ALTER TABLE pos.maintenance_skus DROP COLUMN track_stock;
--           ALTER TABLE pos.maintenance_skus DROP COLUMN stock_on_hand;
set local search_path = pos;

ALTER TABLE maintenance_skus ADD COLUMN track_stock   INTEGER NOT NULL DEFAULT 0;  -- 1 = this item is stocked
ALTER TABLE maintenance_skus ADD COLUMN stock_on_hand INTEGER NOT NULL DEFAULT 0;  -- units currently in the store

CREATE TABLE maintenance_stock_moves (
  id                TEXT PRIMARY KEY,
  sku_id            TEXT NOT NULL REFERENCES maintenance_skus(id) ON DELETE CASCADE,
  issue_id          TEXT REFERENCES maintenance_issues(id) ON DELETE SET NULL,
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  qty               INTEGER NOT NULL,               -- negative = drawn from stock (exchange), positive = restock
  reason            TEXT NOT NULL DEFAULT 'exchange',
  moved_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX maintenance_stock_moves_sku_idx ON maintenance_stock_moves(sku_id);
CREATE INDEX maintenance_stock_moves_issue_idx ON maintenance_stock_moves(issue_id);

-- Every table in pos is owned by pos_app and has RLS enabled (mirrors 0005).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
