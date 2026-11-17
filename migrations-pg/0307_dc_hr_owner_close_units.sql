-- Part 2a of docs/superpowers/plans/2026-11-12-split-permission-areas-part2.md.
--   1. Dream Crafter > HR > Employees gets its own area, dcHr, in a Dream Crafter category (Dream Crafter HR). It
--      shared The Conts' hr area, which the Dream Crafter side closes, so Dream Crafter-only staff could never open it.
--   2. Owner statement close and its four lock powers move from the Finance category to Units, beside the menu item.
--
-- Nobody's level changes on the day it ships:
--   dcHr copies every stored hr row and is pinned where an HR baseline decided hr (it leaves the HR category). Then it
--   is set to none for Dream Crafter-only people, who could not open the page before: their department (and its
--   positions) when the department works on Dream Crafter only, and the person when they work on Dream Crafter only
--   in a department on both sides. Management opens it for them from here.
--   The five Owner statement close areas are pinned where a Finance or Units baseline would decide them. Every
--   department already has its own row for them (migrations 0302 and 0303), so this only reaches newer departments.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0307, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0307';
set local search_path = pos;

-- 1. dcHr from hr.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT r.scope, r.scope_id, 'dcHr', r.level, 'migration 0307'
FROM access_rules r
WHERE r.area = 'hr'
ON CONFLICT (scope, scope_id, area) DO NOTHING;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'dcHr', COALESCE(position_hr.level, department_hr.level, 'none'), 'migration 0307'
FROM positions p
JOIN access_rules position_hr ON position_hr.scope = 'position' AND position_hr.scope_id = p.id
  AND position_hr.area = 'group:HR' AND position_hr.level <> 'inherit'
LEFT JOIN access_rules department_hr ON department_hr.scope = 'department' AND department_hr.scope_id = p.department_id
  AND department_hr.area = 'group:HR' AND department_hr.level <> 'inherit'
WHERE NOT EXISTS (SELECT 1 FROM access_rules department_area
                   WHERE department_area.scope = 'department' AND department_area.scope_id = p.department_id
                     AND department_area.area = 'hr' AND department_area.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', department_hr.scope_id, 'dcHr', department_hr.level, 'migration 0307'
FROM access_rules department_hr
WHERE department_hr.scope = 'department' AND department_hr.area = 'group:HR' AND department_hr.level <> 'inherit'
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

-- Dream Crafter-only people stay closed, as they were.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'dcHr', 'none', 'migration 0307'
FROM departments d WHERE d.side = 'dream_crafter'
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'none', updated_by = EXCLUDED.updated_by;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, 'dcHr', 'none', 'migration 0307'
FROM positions p JOIN departments d ON d.id = p.department_id WHERE d.side = 'dream_crafter'
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'none', updated_by = EXCLUDED.updated_by;

INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'user', u.id, 'dcHr', 'none', 'migration 0307'
FROM users u JOIN departments d ON d.id = u.department_id
WHERE d.side = 'dream_crafter' OR (d.side = 'both' AND u.side = 'dream_crafter')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = 'none', updated_by = EXCLUDED.updated_by;

-- 2. Owner statement close and its powers, Finance to Units.
WITH moved(area) AS (VALUES ('ownerClose'), ('lockIncome'), ('lockDeductions'), ('lockO2'), ('unlockStep'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, mv.area, COALESCE(position_finance.level, department_finance.level, 'none'), 'migration 0307'
FROM positions p
CROSS JOIN moved mv
LEFT JOIN access_rules position_finance ON position_finance.scope = 'position' AND position_finance.scope_id = p.id
  AND position_finance.area = 'group:Finance' AND position_finance.level <> 'inherit'
LEFT JOIN access_rules position_units ON position_units.scope = 'position' AND position_units.scope_id = p.id
  AND position_units.area = 'group:Units' AND position_units.level <> 'inherit'
LEFT JOIN access_rules department_finance ON department_finance.scope = 'department' AND department_finance.scope_id = p.department_id
  AND department_finance.area = 'group:Finance' AND department_finance.level <> 'inherit'
WHERE (position_finance.area IS NOT NULL OR position_units.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules department_area
                   WHERE department_area.scope = 'department' AND department_area.scope_id = p.department_id
                     AND department_area.area = mv.area AND department_area.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

WITH moved(area) AS (VALUES ('ownerClose'), ('lockIncome'), ('lockDeductions'), ('lockO2'), ('unlockStep'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, mv.area, COALESCE(department_finance.level, 'none'), 'migration 0307'
FROM departments d
CROSS JOIN moved mv
LEFT JOIN access_rules department_finance ON department_finance.scope = 'department' AND department_finance.scope_id = d.id
  AND department_finance.area = 'group:Finance' AND department_finance.level <> 'inherit'
LEFT JOIN access_rules department_units ON department_units.scope = 'department' AND department_units.scope_id = d.id
  AND department_units.area = 'group:Units' AND department_units.level <> 'inherit'
WHERE department_finance.area IS NOT NULL OR department_units.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
