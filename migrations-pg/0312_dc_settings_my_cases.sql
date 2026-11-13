-- Dream Crafter boxes one to one with the menu (owner, 12 Nov 2026; follows migration 0310):
--   Service cases > Case settings and My cases get serviceSettings and serviceMyCases (they followed serviceCases).
--   Projects > Project settings gets projectSettings (it followed projects). Calendar stays with Projects: it reads the
--   same board as the Projects list.
--
-- Nobody's level changes on the day it ships: each new area copies every stored row of its parent, at every scope, and
-- sits in its parent's category, so a category baseline still reaches both alike. The engine also gives each the
-- parent's level when a sign-on from older code leaves it out (engine/backend/src/conts/access.ts).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0312, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0312';
set local search_path = pos;

WITH split(area, parent) AS (VALUES
  ('serviceSettings', 'serviceCases'),
  ('serviceMyCases', 'serviceCases'),
  ('projectSettings', 'projects'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, s.area, r.level, 'migration 0312'
FROM access_rules r
JOIN split s ON s.parent = r.area
ON CONFLICT (scope, scope_id, area) DO NOTHING;
