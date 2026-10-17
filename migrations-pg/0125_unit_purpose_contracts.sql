-- Staff comment sheet "ERP THE CONTS COMMENT.xlsx", sheet UNIT (17 Oct 2026), with the owner's clarification the same day.
--
--   units.purpose        rental (short stays sold on the channels, as every unit so far), showroom (a Dream Crafter or
--                        Inhouse Reno display unit) or warehouse (the renovation warehouse). Only rental units are ever
--                        connected to the channels, priced, put on the reservations calendar or counted in occupancy.
--   units.used_by        optional: which business uses the unit (The Conts, Dream Crafter, Inhouse Reno).
--   units.beds           the beds and mattresses in the unit: [{ "size": "king", "quantity": 1 }, ...].
--   unit_parking_bays    any number of car park bays per unit, each with its lot number and an optional level and note.
--   owner_contracts.contract_code       the staff's short code for the income model (WH, PS, PS GRR, PS YGRR, LT, RTR,
--                        MANAGE, GRR). Null on older rows: read from revenue_model (functions/_lib/unitPurpose.ts).
--   owner_contracts.revenue_model       gains management_yearly_guarantee (PS YGRR): a profit share whose guarantee is
--                        checked once per contract year, not per month (functions/_lib/ownerStatement.ts).
--   owner_contracts.agreement_document_id  the signed agreement or memo a renewal was saved with (required for one).
--   unit_lettings        "Agent to let": a unit we find a long-term tenant for on the owner's behalf.
--   agreement_templates  the management agreement text the contract generator fills in; each save is a new version.
--
-- Every existing unit becomes a rental unit (all of them are short-stay units today). Code that reads these columns
-- checks they exist first, so the app keeps working on a database this has not reached yet.
--
-- REVERSAL:
--   DROP TABLE agreement_templates; DROP TABLE unit_lettings; DROP TABLE unit_parking_bays;
--   ALTER TABLE owner_contracts DROP COLUMN agreement_document_id, DROP COLUMN contract_code;
--   UPDATE owner_contracts SET revenue_model = 'management_guarantee' WHERE revenue_model = 'management_yearly_guarantee';
--   ALTER TABLE owner_contracts DROP CONSTRAINT owner_contracts_revenue_model_check;
--   ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_revenue_model_check CHECK (revenue_model IN ('management','management_guarantee','grr','master_lease','long_term'));
--   ALTER TABLE units DROP COLUMN beds, DROP COLUMN used_by, DROP COLUMN purpose;
set local search_path = pos;

ALTER TABLE units ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'rental';
ALTER TABLE units ADD CONSTRAINT units_purpose_check CHECK (purpose IN ('rental', 'showroom', 'warehouse'));
ALTER TABLE units ADD COLUMN IF NOT EXISTS used_by TEXT;
ALTER TABLE units ADD CONSTRAINT units_used_by_check CHECK (used_by IS NULL OR used_by IN ('the_conts', 'dream_crafter', 'inhouse_reno'));
ALTER TABLE units ADD COLUMN IF NOT EXISTS beds JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE units ADD CONSTRAINT units_beds_array CHECK (jsonb_typeof(beds) = 'array');

CREATE TABLE IF NOT EXISTS unit_parking_bays (
  id          TEXT PRIMARY KEY,
  unit_id     TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  lot_number  TEXT NOT NULL CHECK (length(btrim(lot_number)) BETWEEN 1 AND 40),
  level       TEXT CHECK (level IS NULL OR length(level) <= 40),
  note        TEXT CHECK (note IS NULL OR length(note) <= 200),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS unit_parking_bays_unit_idx ON unit_parking_bays(unit_id, sort_order);

ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_revenue_model_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_revenue_model_check
  CHECK (revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term'));
ALTER TABLE owner_contracts ADD COLUMN IF NOT EXISTS contract_code TEXT;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_check
  CHECK (contract_code IS NULL OR contract_code IN ('WH', 'PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'));
ALTER TABLE owner_contracts ADD COLUMN IF NOT EXISTS agreement_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS unit_lettings (
  id            TEXT PRIMARY KEY,
  unit_id       TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'looking' CHECK (status IN ('looking', 'rented', 'closed')),
  tenant_name   TEXT CHECK (tenant_name IS NULL OR length(tenant_name) <= 160),
  tenant_phone  TEXT CHECK (tenant_phone IS NULL OR length(tenant_phone) <= 40),
  starts_on     TEXT CHECK (starts_on IS NULL OR starts_on ~ '^\d{4}-\d{2}-\d{2}$'),
  ends_on       TEXT CHECK (ends_on IS NULL OR ends_on ~ '^\d{4}-\d{2}-\d{2}$'),
  monthly_rent  INTEGER CHECK (monthly_rent IS NULL OR monthly_rent >= 0),
  agent_fee     INTEGER CHECK (agent_fee IS NULL OR agent_fee >= 0),
  notes         TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS unit_lettings_unit_idx ON unit_lettings(unit_id);
CREATE INDEX IF NOT EXISTS unit_lettings_ends_idx ON unit_lettings(ends_on) WHERE status = 'rented';

CREATE TABLE IF NOT EXISTS agreement_templates (
  id          TEXT PRIMARY KEY,
  version     INTEGER NOT NULL UNIQUE CHECK (version > 0),
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by_label TEXT
);

-- Row level security on with no policies, as for every pos table: Supabase's API roles see nothing.
ALTER TABLE unit_parking_bays ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_lettings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON unit_parking_bays, unit_lettings, agreement_templates TO pos_app;
-- Owned by pos_app like the other pos tables, so the app's role is not filtered by row level security.
ALTER TABLE unit_parking_bays OWNER TO pos_app;
ALTER TABLE unit_lettings OWNER TO pos_app;
ALTER TABLE agreement_templates OWNER TO pos_app;

-- A neutral placeholder: the company pastes its real agreement wording in Settings > Agreement template.
INSERT INTO agreement_templates (id, version, title, body, created_at, created_by_label) VALUES (
  'agreement-template-v1', 1, 'Property Management Agreement',
  E'PLACEHOLDER TEMPLATE. Replace this text with the company''s own agreement in Settings > Agreement template.\n\n'
  || E'This agreement is made on {{today}} between {{company_name}} (company no. {{company_number}}) of {{company_address}} ("the Company") '
  || E'and {{owner_name}} (IC / company no. {{owner_ic}}) of {{owner_address}} ("the Owner").\n\n'
  || E'# 1. The unit\n'
  || E'The Owner appoints the Company for unit {{unit_code}} at {{building}}, {{unit_address}} ({{unit_layout}}).\n\n'
  || E'# 2. Term\n'
  || E'This agreement runs from {{start_date}} to {{end_date}}.\n\n'
  || E'# 3. Income model\n'
  || E'{{model_code}}: {{model_name}}. {{terms}}\n'
  || E'Owner share: {{owner_pct}}. Operator share: {{management_pct}}. Guarantee: {{guarantee}}. Monthly rent: {{monthly_rent}}.\n\n'
  || E'# 4. Payment\n'
  || E'Payments to the Owner are made to {{bank_name}} account {{bank_account}} in the name of {{account_holder}}.\n\n'
  || E'# 5. Signatures\n'
  || E'Signed for the Company: ____________________          Signed by the Owner: ____________________',
  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'System')
ON CONFLICT (id) DO NOTHING;
