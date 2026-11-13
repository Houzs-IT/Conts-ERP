-- Reservations splits into three areas: Calendar, Reservations and Guests. Each new area gets a copy of every stored
-- 'reservations' row, at every scope, so nobody's level changes until management sets the new areas apart.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0304, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0304';
set local search_path = pos;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, split.new_area, r.level, 'migration 0304'
FROM access_rules r
CROSS JOIN (VALUES ('calendar'), ('guests')) AS split(new_area)
WHERE r.area = 'reservations'
ON CONFLICT (scope, scope_id, area) DO NOTHING;
