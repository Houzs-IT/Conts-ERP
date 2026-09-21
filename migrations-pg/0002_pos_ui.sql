-- Tables the Conts ERP screens need that the original schema did not have.
-- REVERSAL: DROP TABLE unit_expenses; DROP TABLE channel_rates; ALTER TABLE units DROP COLUMN listing_name, DROP COLUMN unit_code, DROP COLUMN address, DROP COLUMN package, DROP COLUMN term, DROP COLUMN split_kind, DROP COLUMN split_value; ALTER TABLE owners DROP COLUMN ic_number, DROP COLUMN bank_account_holder, DROP COLUMN bank_account_number; ALTER TABLE inventory_items DROP COLUMN category, DROP COLUMN replace_by, DROP COLUMN notes; ALTER TABLE owner_contracts DROP COLUMN model, DROP COLUMN grr_amount, DROP COLUMN offer_letter; (and restore expenses_category_check to the eight original categories)
set local search_path = pos;

-- One row per unit, sales channel and night whose price was set by hand.
-- 'web' is the direct rate; nights with no row use the unit's base rate times the channel uplift.
CREATE TABLE channel_rates (
  unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('web','airbnb','booking_com','agoda')),
  rate_date  TEXT NOT NULL,
  rate       INTEGER NOT NULL CHECK (rate >= 0),   -- sen
  updated_at TEXT NOT NULL,
  PRIMARY KEY (unit_id, channel, rate_date)
);

-- Property master data the Properties screen edits. Every column is nullable or defaulted, so existing rows stay valid.
ALTER TABLE units ADD COLUMN listing_name TEXT;
ALTER TABLE units ADD COLUMN unit_code    TEXT;
ALTER TABLE units ADD COLUMN address      TEXT;
ALTER TABLE units ADD COLUMN package      TEXT NOT NULL DEFAULT 'Package C' CHECK (package IN ('Package A','Package B','Package C'));
ALTER TABLE units ADD COLUMN term         TEXT NOT NULL DEFAULT 'Long term' CHECK (term IN ('Long term','Short term'));
ALTER TABLE units ADD COLUMN split_kind   TEXT NOT NULL DEFAULT 'Not set' CHECK (split_kind IN ('Not set','Profit share','GRR — guaranteed rent'));
ALTER TABLE units ADD COLUMN split_value INTEGER;   -- sen for a guaranteed rent, whole percent for a profit share

-- Personal and banking details of the owner. Only management, finance and operations managers may read or change them.
ALTER TABLE owners ADD COLUMN ic_number           TEXT;
ALTER TABLE owners ADD COLUMN bank_account_holder TEXT;
ALTER TABLE owners ADD COLUMN bank_account_number TEXT;

-- What the Inventory screen shows beyond the original columns.
ALTER TABLE inventory_items ADD COLUMN category   TEXT NOT NULL DEFAULT 'furniture' CHECK (category IN ('furniture','appliance','electronics','linen','kitchenware','fittings'));
ALTER TABLE inventory_items ADD COLUMN replace_by TEXT;
ALTER TABLE inventory_items ADD COLUMN notes      TEXT NOT NULL DEFAULT '';

-- The Expenses screen also records internet, electricity, water and cleaning.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('internet','electricity','water','cleaning','housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other'));

-- How an owner is paid: a management fee on revenue, or a guaranteed monthly rent (GRR).
ALTER TABLE owner_contracts ADD COLUMN model        TEXT NOT NULL DEFAULT 'management' CHECK (model IN ('management','grr'));
ALTER TABLE owner_contracts ADD COLUMN grr_amount   INTEGER NOT NULL DEFAULT 0;   -- sen per month, for model 'grr'
ALTER TABLE owner_contracts ADD COLUMN offer_letter TEXT;

-- The recurring monthly costs set on a unit (internet, electricity, water, cleaning ...), deducted on the owner statement.
CREATE TABLE unit_expenses (
  id         TEXT PRIMARY KEY,
  unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount >= 0),   -- sen per month
  note       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX unit_expenses_unit_idx ON unit_expenses(unit_id);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
