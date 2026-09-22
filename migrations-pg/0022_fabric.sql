-- Fabric library, ported from 2990's SCM (`fabric_library`). Upholstery fabric catalogue
-- with a pricing tier + surcharge. Furniture-specific. Surcharge is integer sen.
-- REVERSAL: DROP TABLE fabric_library;
set local search_path = pos;

CREATE TABLE fabric_library (
  id                    TEXT PRIMARY KEY,
  fabric_code           TEXT,
  label                 TEXT NOT NULL,
  tier                  TEXT NOT NULL DEFAULT 'standard',
  default_surcharge_sen INTEGER NOT NULL DEFAULT 0,
  sofa_tier             TEXT,
  bedframe_tier         TEXT,
  swatch_key            TEXT,
  active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_fabric_tier ON fabric_library (tier);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
