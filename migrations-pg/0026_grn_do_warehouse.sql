-- Wire GRN receipts and DO deliveries into the stock ledger. A GRN receives INTO a
-- warehouse (posts RECEIPT +qty_accepted); a DO ships FROM a warehouse (posts ISSUE -qty).
-- Both get a nullable warehouse_id so historical rows and warehouse-less receipts/deliveries
-- still work; movements are posted only when a warehouse is chosen. Cancelling reverses.
-- REVERSAL: ALTER TABLE goods_receipts DROP COLUMN warehouse_id;
--           ALTER TABLE delivery_orders DROP COLUMN warehouse_id;
set local search_path = pos;

ALTER TABLE goods_receipts ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id);
ALTER TABLE delivery_orders ADD COLUMN warehouse_id TEXT REFERENCES warehouses(id);

CREATE INDEX idx_grn_warehouse ON goods_receipts (warehouse_id);
CREATE INDEX idx_do_warehouse ON delivery_orders (warehouse_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
