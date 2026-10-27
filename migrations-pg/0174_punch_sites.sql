-- Punch sites (owner, 27 Oct 2026: bring Hookka's punch clock in as Houzs Century did): the places a phone punch is
-- checked against besides the buildings, each a point and its own radius, kept on Employees > Hours > Punch Sites.
--
--   punch_sites   an office, a warehouse, a big site: anywhere staff clock in that is not a building, or a building that
--                 needs a wider or narrower circle than the 200 m every building gets. Within the radius a punch reads
--                 "At <site>"; further out it reads "<distance> from <site>". Only a label, never a refusal (Hookka's soft
--                 geofence). A punch is not tied to a site row: the label is worked out when the day is read, so a site
--                 moved or switched off changes how old punches read. Switched off, never deleted.
--
-- One company: The Conts has one set of sites, so there is no company column (Century keeps one per company).
--
-- Optional: the code reads punch_sites only when the table exists; without it punches are checked against the buildings
-- alone, as before, and the Punch Sites tab answers "needs a database update".
--
-- REVERSAL: DROP TABLE punch_sites;  (nothing else is changed by this file)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS punch_sites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  lat         DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_m    INTEGER NOT NULL DEFAULT 200 CHECK (radius_m BETWEEN 20 AND 5000),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- A handful of rows, read whole: no index beyond the key.

ALTER TABLE punch_sites OWNER TO pos_app;
ALTER TABLE punch_sites ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON punch_sites TO pos_app;
