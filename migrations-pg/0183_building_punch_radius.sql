-- A punch radius per building (owner, 27 Oct 2026: bring Hookka's punch clock in; "give each building a radius", no
-- separate punch-site table). Set on Employees > Hours > Punch Sites.
--
--   properties.punch_radius_m   how far from the building's map location a phone punch still reads "At <building>";
--                               further out it reads "<distance> from <building>". Empty = the default 200 m every
--                               building had before. Only a label, never a refusal (Hookka's soft geofence). A punch is
--                               not tied to a building row: the label is worked out when the day is read, so a changed
--                               radius changes how old punches read.
--
-- Optional: the code reads punch_radius_m only when it exists; without it every building keeps 200 m and the Punch
-- Sites tab answers "needs a database update".
--
-- REVERSAL: ALTER TABLE properties DROP COLUMN punch_radius_m;  (nothing else is changed by this file)
set local search_path = pos;

ALTER TABLE properties ADD COLUMN IF NOT EXISTS punch_radius_m INTEGER CHECK (punch_radius_m IS NULL OR punch_radius_m BETWEEN 20 AND 5000);
