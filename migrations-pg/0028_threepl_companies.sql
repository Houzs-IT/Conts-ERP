-- 3PL Companies, ported from 2990's SCM (threepl_companies) — third-party logistics
-- providers that drivers/vehicles can belong to. A master, like suppliers. Phones are
-- stored as typed (Conts has no phone-normaliser yet). REVERSAL: DROP TABLE threepl_companies;
set local search_path = pos;

CREATE TABLE threepl_companies (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  registration_no  TEXT,
  contact_name     TEXT,
  contact_phone    TEXT,
  office_phone     TEXT,
  email            TEXT,
  address          TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (code)
);

CREATE INDEX idx_threepl_active ON threepl_companies (is_active);
CREATE INDEX idx_threepl_name ON threepl_companies (name);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
