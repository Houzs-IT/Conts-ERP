-- The bed size list (King, Queen, ...) the unit's Beds and mattresses pick from, kept by staff on Units > Unit settings
-- instead of in code (owner, 4 Nov 2026). units.beds keeps holding the key ([{ "size": "queen", "quantity": 2 }]), so
-- the seed keeps the keys the code used. A hidden size stays valid on the units that have it.
--
-- REVERSAL:
--   DROP TABLE unit_bed_sizes;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS unit_bed_sizes (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  label       TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unit_bed_sizes_label_idx ON unit_bed_sizes (lower(btrim(label)));
INSERT INTO unit_bed_sizes (key, label, sort_order, created_at, updated_at) VALUES
  ('king', 'King', 10, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('queen', 'Queen', 20, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('super_single', 'Super single', 30, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('single', 'Single', 40, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('sofa_bed', 'Sofa bed', 50, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('single_floor_mattress', 'Single floor mattress', 60, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('double_decker', 'Double decker', 70, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
ON CONFLICT (key) DO NOTHING;

-- Row level security on with no policies, as for every pos table: Supabase's API roles see nothing.
ALTER TABLE unit_bed_sizes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON unit_bed_sizes TO pos_app;
ALTER TABLE unit_bed_sizes OWNER TO pos_app;
