-- Category display master, ported from 2990's SCM (`categories`). Gives each product
-- category a label, icon and sort order for pickers. Id is a slug the operator sets.
-- REVERSAL: DROP TABLE product_categories;
set local search_path = pos;

CREATE TABLE product_categories (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  icon           TEXT NOT NULL,
  tbc            INTEGER NOT NULL DEFAULT 0 CHECK (tbc IN (0, 1)),
  hero_image_key TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
