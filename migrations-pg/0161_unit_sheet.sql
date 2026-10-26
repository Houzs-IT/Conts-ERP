-- Staff comment sheet UNIT (23 Oct 2026), with the owner's answers of 26 Oct 2026 (PLAN-units-form.md).
--
--   unit_layout_types    the unit Type list (Studio, 1 bedroom, ...), kept by staff on the screen instead of in code.
--                        units.layout_type now points at it; a hidden type stays valid on the units that have it.
--                        The cleaning price grid has one row per type, so a new type is priced like the others.
--   properties.full_access_card   the building's card opens the lobby, lift and car park on its own.
--   access_credentials.used_by    who is given the access item: maintenance, cleaner, guest, sales, management.
--                        Every existing item keeps going to everyone.
--   owner_contracts      Rent to rent (RTR) records both sides: what we pay the owner (grr_amount, deposit_amount as
--                        before, plus deposit_utilities, deposit_card) and what we rent it out for (rent_out_*). Sen.
--                        Recorded only: the company result still comes from the reservations.
--
-- Code that reads these checks they exist first, so the app keeps working on a database this has not reached yet.
--
-- REVERSAL:
--   ALTER TABLE owner_contracts DROP COLUMN deposit_utilities, DROP COLUMN deposit_card, DROP COLUMN rent_out_amount,
--     DROP COLUMN rent_out_deposit, DROP COLUMN rent_out_deposit_utilities, DROP COLUMN rent_out_deposit_card;
--   ALTER TABLE access_credentials DROP COLUMN used_by;
--   ALTER TABLE properties DROP COLUMN full_access_card;
--   UPDATE units SET layout_type = 'other' WHERE layout_type NOT IN ('studio','1_bedroom','2_bedroom','3_bedroom','4_plus_bedroom','duplex','dual_key','penthouse','other');
--   ALTER TABLE units DROP CONSTRAINT units_layout_type_fk;
--   ALTER TABLE units ADD CONSTRAINT units_layout_type_check CHECK (layout_type IS NULL OR layout_type IN
--     ('studio','1_bedroom','2_bedroom','3_bedroom','4_plus_bedroom','duplex','dual_key','penthouse','other'));
--   DROP TABLE unit_layout_types;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS unit_layout_types (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label       TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_layout_types_label_idx ON unit_layout_types (lower(btrim(label)));
INSERT INTO unit_layout_types (key, label, sort_order, created_at, updated_at) VALUES
  ('studio', 'Studio', 10, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('1_bedroom', '1 bedroom', 20, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('2_bedroom', '2 bedroom', 30, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('3_bedroom', '3 bedroom', 40, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('4_plus_bedroom', '4+ bedroom', 50, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('duplex', 'Duplex', 60, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('dual_key', 'Dual key', 70, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('penthouse', 'Penthouse', 80, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z'),
  ('other', 'Other', 1000, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE units DROP CONSTRAINT IF EXISTS units_layout_type_check;
ALTER TABLE units ADD CONSTRAINT units_layout_type_fk FOREIGN KEY (layout_type) REFERENCES unit_layout_types(key) ON UPDATE CASCADE;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS full_access_card BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE access_credentials ADD COLUMN IF NOT EXISTS used_by JSONB NOT NULL
  DEFAULT '["maintenance","cleaner","guest","sales","management"]'::jsonb;
ALTER TABLE access_credentials ADD CONSTRAINT access_credentials_used_by_array CHECK (jsonb_typeof(used_by) = 'array');

ALTER TABLE owner_contracts
  ADD COLUMN IF NOT EXISTS deposit_utilities INTEGER CHECK (deposit_utilities IS NULL OR deposit_utilities >= 0),
  ADD COLUMN IF NOT EXISTS deposit_card INTEGER CHECK (deposit_card IS NULL OR deposit_card >= 0),
  ADD COLUMN IF NOT EXISTS rent_out_amount INTEGER CHECK (rent_out_amount IS NULL OR rent_out_amount >= 0),
  ADD COLUMN IF NOT EXISTS rent_out_deposit INTEGER CHECK (rent_out_deposit IS NULL OR rent_out_deposit >= 0),
  ADD COLUMN IF NOT EXISTS rent_out_deposit_utilities INTEGER CHECK (rent_out_deposit_utilities IS NULL OR rent_out_deposit_utilities >= 0),
  ADD COLUMN IF NOT EXISTS rent_out_deposit_card INTEGER CHECK (rent_out_deposit_card IS NULL OR rent_out_deposit_card >= 0);

-- Row level security on with no policies, as for every pos table: Supabase's API roles see nothing.
ALTER TABLE unit_layout_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON unit_layout_types TO pos_app;
ALTER TABLE unit_layout_types OWNER TO pos_app;
