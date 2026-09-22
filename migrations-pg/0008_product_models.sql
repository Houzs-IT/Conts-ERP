-- Product models, ported from 2990's SCM (`product_models`). A model groups SKUs of the
-- same design; `allowed_options` (jsonb) holds the variant matrix the deep configurator
-- edits — kept here for fidelity but not yet surfaced (the Variants tier will edit it).
-- Category is the same 9-value app set as products (2990's MFG_PRODUCT_CATEGORIES).
-- REVERSAL: DROP TABLE product_models;
set local search_path = pos;

CREATE TABLE product_models (
  id              TEXT PRIMARY KEY,
  model_code      TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN ('SOFA','BEDFRAME','ACCESSORY','MATTRESS','BEDLINES','DINING','DIFFUSER','CARPET','SERVICE')),
  branding        TEXT,
  description     TEXT,
  photo_url       TEXT,
  allowed_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (model_code)
);

CREATE INDEX idx_product_models_category ON product_models (category);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
