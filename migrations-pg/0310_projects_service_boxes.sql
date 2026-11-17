-- Part 2c of docs/superpowers/plans/2026-11-12-split-permission-areas-part2.md.
--   Service cases > Quality metrics gets its own area, serviceMetrics (it followed serviceCases).
--   Projects > Defects, Handover checklists and Finances get projectDefects, projectHandover and projectFinances
--   (they followed projects). Project settings, Case settings and My cases stay with their parent.
--
-- Nobody's level changes on the day it ships: each new area copies every stored row of its parent, at every scope.
-- Each sits in its parent's category, so a category baseline still reaches both alike. The engine also gives each the
-- parent's level when a sign-on from older code leaves it out (engine/backend/src/conts/access.ts).
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0310, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0310';
set local search_path = pos;

WITH split(area, parent) AS (VALUES
  ('serviceMetrics', 'serviceCases'),
  ('projectDefects', 'projects'),
  ('projectHandover', 'projects'),
  ('projectFinances', 'projects'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, s.area, r.level, 'migration 0310'
FROM access_rules r
JOIN split s ON s.parent = r.area
ON CONFLICT (scope, scope_id, area) DO NOTHING;
