-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0199';
-- Messages moves from the Reservations section of the menu to Growth, below Reviews (owner, 2 Nov 2026), so its
-- permission area (comms) moves from the Reservations category to Growth (functions/_lib/access.ts). This is step 3
-- of migration 0182 run the other way for that one area.
--
-- Nobody's level changes. A person's level in an area is the first of: their own row, their position's area row, their
-- department's area row, their position's category baseline, their department's category baseline (resolveFor).
-- Wherever the Growth baseline would now decide comms instead of the Reservations baseline, comms is pinned, as its own
-- row, to the level it has today. Positions are pinned first, against their department's rows as they are before this
-- file, so a department's own comms row keeps beating a position's baseline. A row stored as 'inherit' counts as no row
-- and is replaced by the pin; any other existing comms row is left as it is.
-- The same limit as 0182: a position's department is read from positions.department_id.
--
-- Both categories are closed by the Dream Crafter side, so the side rule changes nothing here.
set local search_path = pos;

-- a. Pins at position scope, before any department pin exists.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'comms', COALESCE(pr.level, dr.level, 'none'), 'migration 0199'
FROM positions p
LEFT JOIN access_rules pr ON pr.scope = 'position' AND pr.scope_id = p.id AND pr.area = 'group:Reservations' AND pr.level <> 'inherit'
LEFT JOIN access_rules pg ON pg.scope = 'position' AND pg.scope_id = p.id AND pg.area = 'group:Growth' AND pg.level <> 'inherit'
LEFT JOIN access_rules dr ON dr.scope = 'department' AND dr.scope_id = p.department_id AND dr.area = 'group:Reservations' AND dr.level <> 'inherit'
WHERE (pr.area IS NOT NULL OR pg.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules da
                   WHERE da.scope = 'department' AND da.scope_id = p.department_id AND da.area = 'comms' AND da.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

-- b. Pins at department scope.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'comms', COALESCE(dr.level, 'none'), 'migration 0199'
FROM departments d
LEFT JOIN access_rules dr ON dr.scope = 'department' AND dr.scope_id = d.id AND dr.area = 'group:Reservations' AND dr.level <> 'inherit'
LEFT JOIN access_rules dg ON dg.scope = 'department' AND dg.scope_id = d.id AND dg.area = 'group:Growth' AND dg.level <> 'inherit'
WHERE dr.area IS NOT NULL OR dg.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
