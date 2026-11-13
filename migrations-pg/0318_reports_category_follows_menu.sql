-- The Permissions chart follows the new menu (owner, 12 Nov 2026): the Reports section left the sidebar, so the Reports
-- category goes too. Portfolio and Performance move to Home; Reports (the yearly and YGRR unit report) moves to Units.
--
-- Nobody's level changes. An area that changes category would start following the new category's baseline, so it is
-- pinned, as its own row, to the level the Reports baseline gave it wherever a Reports or new-category baseline would
-- otherwise decide it. Positions first, then departments, as in migrations 0182 and 0306. A row of the area itself
-- already beats every baseline, so it is left alone. The group:Reports rows stay; the code no longer reads them.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0318, dry run first.
-- REVERSAL: DELETE FROM pos.access_rules WHERE updated_by = 'migration 0318';
set local search_path = pos;

WITH moved(area, new_group) AS (VALUES ('portfolio', 'group:Home'), ('performance', 'group:Home'), ('reports', 'group:Units'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'position', p.id, moved.area, COALESCE(position_reports.level, department_reports.level, 'none'), 'migration 0318'
FROM positions p
CROSS JOIN moved
LEFT JOIN access_rules position_reports ON position_reports.scope = 'position' AND position_reports.scope_id = p.id
  AND position_reports.area = 'group:Reports' AND position_reports.level <> 'inherit'
LEFT JOIN access_rules position_new ON position_new.scope = 'position' AND position_new.scope_id = p.id
  AND position_new.area = moved.new_group AND position_new.level <> 'inherit'
LEFT JOIN access_rules department_reports ON department_reports.scope = 'department' AND department_reports.scope_id = p.department_id
  AND department_reports.area = 'group:Reports' AND department_reports.level <> 'inherit'
WHERE (position_reports.area IS NOT NULL OR position_new.area IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM access_rules department_area
                   WHERE department_area.scope = 'department' AND department_area.scope_id = p.department_id
                     AND department_area.area = moved.area AND department_area.level <> 'inherit')
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';

WITH moved(area, new_group) AS (VALUES ('portfolio', 'group:Home'), ('performance', 'group:Home'), ('reports', 'group:Units'))
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, moved.area, COALESCE(department_reports.level, 'none'), 'migration 0318'
FROM departments d
CROSS JOIN moved
LEFT JOIN access_rules department_reports ON department_reports.scope = 'department' AND department_reports.scope_id = d.id
  AND department_reports.area = 'group:Reports' AND department_reports.level <> 'inherit'
LEFT JOIN access_rules department_new ON department_new.scope = 'department' AND department_new.scope_id = d.id
  AND department_new.area = moved.new_group AND department_new.level <> 'inherit'
WHERE department_reports.area IS NOT NULL OR department_new.area IS NOT NULL
ON CONFLICT (scope, scope_id, area) DO UPDATE SET level = EXCLUDED.level, updated_by = EXCLUDED.updated_by
  WHERE access_rules.level = 'inherit';
