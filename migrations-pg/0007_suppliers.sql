-- Supplier master, ported from 2990's SCM (`suppliers` table in 2990s-full-schema.sql).
-- 2990 is the source of truth for the logic; Conts is single-tenant so 2990's per-company
-- scoping is dropped. Only `status` is an enum there; statement_type/aging_basis/currency
-- are plain text defaults — mirrored here. Money is integer sen. Supplier↔material bindings
-- and the PO scorecard are deferred until the materials/PO modules land.
-- REVERSAL: DROP TABLE suppliers;
set local search_path = pos;

CREATE TABLE suppliers (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  contact_person  TEXT,
  attention       TEXT,
  phone           TEXT,
  mobile          TEXT,
  whatsapp_number TEXT,
  fax             TEXT,
  email           TEXT,
  website         TEXT,
  address         TEXT,
  area            TEXT,
  postcode        TEXT,
  state           TEXT,
  country         TEXT NOT NULL DEFAULT 'Malaysia',
  payment_terms   TEXT,
  credit_limit_sen INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'MYR',
  statement_type  TEXT NOT NULL DEFAULT 'OPEN_ITEM',
  aging_basis     TEXT NOT NULL DEFAULT 'INVOICE_DATE',
  supplier_type   TEXT,
  category        TEXT,
  business_nature TEXT,
  tin_number      TEXT,
  business_reg_no TEXT,
  rating          INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (code)
);

CREATE INDEX idx_suppliers_status ON suppliers (status);
CREATE INDEX idx_suppliers_name ON suppliers (name);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
