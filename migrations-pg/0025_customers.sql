-- Customer master (debtors), the sell-side counterpart of suppliers. Sales orders record a
-- customer inline today; this master lets them be reused. Money integer sen.
-- REVERSAL: DROP TABLE customers;
set local search_path = pos;

CREATE TABLE customers (
  id               TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','BLOCKED')),
  contact_person   TEXT,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  area             TEXT,
  postcode         TEXT,
  state            TEXT,
  country          TEXT NOT NULL DEFAULT 'Malaysia',
  payment_terms    TEXT,
  credit_limit_sen INTEGER NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL DEFAULT 'MYR',
  tin_number       TEXT,
  business_reg_no  TEXT,
  customer_type    TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (code)
);

CREATE INDEX idx_customers_status ON customers (status);
CREATE INDEX idx_customers_name ON customers (name);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
