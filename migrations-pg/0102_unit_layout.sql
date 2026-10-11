-- A unit's layout (户型), for cleaning: the Cleaning board shows "2 bedroom · 2 bath" from it (owner, 11 Oct 2026).
-- bedrooms, bathrooms and size_sqft already exist (0001); this adds the layout type. NULL = not set: the screens
-- show the type the bedroom count implies until someone picks one.
--
-- REVERSAL: ALTER TABLE pos.units DROP COLUMN layout_type;
set local search_path = pos;

ALTER TABLE units ADD COLUMN IF NOT EXISTS layout_type TEXT
  CHECK (layout_type IS NULL OR layout_type IN ('studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom', 'duplex', 'dual_key', 'penthouse', 'other'));
