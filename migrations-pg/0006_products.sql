-- The product / item master ("Products & Maintenance"), ported from Houzs ERP's
-- mfg_products SKU master. Browsed by category. Money is integer sen. Codes are unique
-- and entered by hand or via CSV import (no auto-numbering — matches Houzs).
-- REVERSAL: DROP TABLE products;
set local search_path = pos;

CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL CHECK (category IN ('SOFA','BEDFRAME','ACCESSORY','MATTRESS','BEDLINES','DINING','DIFFUSER','CARPET','SERVICE')),
  description    TEXT,
  base_model     TEXT,
  size_code      TEXT,
  size_label     TEXT,
  branding       TEXT,
  barcode        TEXT,
  unit_m3_milli  INTEGER NOT NULL DEFAULT 0,          -- volume in milli-m3, shown /1000
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  cost_price_sen INTEGER NOT NULL DEFAULT 0,          -- finance-gated, never sent to non-finance roles
  base_price_sen INTEGER,                             -- Price 2 (a mattress uses this as its single Price)
  price1_sen     INTEGER,                             -- Price 1 (alternate tier; null for mattress/service)
  sell_price_sen INTEGER,                             -- current selling price a document line defaults from
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (code)
);

CREATE INDEX idx_products_category ON products (category);

-- Every pos table is owned by pos_app and has RLS on with no policy, so only the
-- Worker's Hyperdrive connection reaches it (same guard the rest of the schema uses).
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
