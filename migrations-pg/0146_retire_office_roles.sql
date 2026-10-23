-- Retires the office roles operations_manager and finance_admin (PLAN.md, owner 23 Oct 2026). What made them different
-- now lives in rules: the Operations Manager position and the Finance department (migration 0145). Run it when the code
-- that reads departments and positions deploys, not before: until then the live code still branches on these roles.
--
-- Before the roles go, three clean-ups that 0145 could not know about (0145 itself is not changed: it is already applied):
-- * Every account that still holds operations_manager gets the Operations department and the Operations Manager position,
--   whatever its position text said, because that position is what carries the manager rules. Its text columns follow.
-- * Any non-owner account with no department (made after 0145 ran, before the screens set one) gets the department and
--   position 0145 would have given its role. Side follows the department; legacy_role is set if it is empty.
-- * A staff department that has no rules at all (a free-text department 0145 added, or one made on the list screen
--   without rules) gets a copy of the Operations department's rules, the same ones 0145 gave Sales, Design, Renovation
--   and Admin. Without that it would be left with No access everywhere.
--
-- * users.role becomes operations_staff for both retired roles. legacy_role (0145) keeps the old value, so nothing is lost.
-- * The CHECK on users.role is left as it is. Both retired values stay valid so the reversal below can put them back.
-- * Two-step sign-in is saved by department now (security.require2faDepartments, department ids) plus one switch for
--   owners (security.require2faOwners, 'true' or 'false', the way the settings screen stores a switch). The old list of
--   roles is copied across with the same mapping as functions/_lib/twoStepLegacy.ts:
--     management -> departments of kind management, operations_staff -> every staff department, finance_admin -> Finance,
--     operations_manager -> Operations, housekeeper -> cleaning departments, technician -> maintenance departments,
--     owner -> the owners switch.
--   The old setting is left in place; the code reads it only while the new one does not exist.
--
-- REVERSAL: update pos.users set role = legacy_role where legacy_role in ('operations_manager','finance_admin');
--   delete from pos.settings where key in ('security.require2faDepartments', 'security.require2faOwners');
--   The account moves and the copied department rules are not undone: they only make the data match what the roles gave,
--   and nothing that reads the old role chart looks at them.
-- APPLY: needs 0145 first. Staging first, then production from the "Apply migrations to production" action together
-- with the deploy of the code that follows departments.
set local search_path = pos;

-- Make sure the old role is on record before it is overwritten (0145 already did this for every non-owner).
UPDATE users SET legacy_role = role
WHERE legacy_role IS NULL AND role IN ('operations_manager', 'finance_admin');

-- Accounts with no department get the one 0145 would have given their role.
UPDATE users u SET department_id = d.id, position_id = p.id, department = d.name, "position" = p.name,
                   side = CASE WHEN d.kind = 'management' THEN 'both' ELSE d.side END,
                   legacy_role = COALESCE(u.legacy_role, u.role),
                   updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES
  ('management',         'Management',  'Director'),
  ('operations_manager', 'Operations',  'Operations Manager'),
  ('finance_admin',      'Finance',     'Finance Admin'),
  ('operations_staff',   'Operations',  'Operations Staff'),
  ('housekeeper',        'Cleaning',    'Cleaner'),
  ('technician',         'Maintenance', 'Technician')
) AS m(role, dept, pos)
JOIN departments d ON lower(d.name) = lower(m.dept)
LEFT JOIN positions p ON p.department_id = d.id AND lower(p.name) = lower(m.pos)
WHERE u.role = m.role AND u.department_id IS NULL AND u.role <> 'owner';

-- Operations managers: the Operations Manager position, whatever their position text was.
UPDATE users u SET department_id = d.id, position_id = p.id, department = d.name, "position" = p.name, side = d.side,
                   updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM departments d
JOIN positions p ON p.department_id = d.id AND p.name = 'Operations Manager'
WHERE d.name = 'Operations' AND u.role = 'operations_manager';

-- Staff departments with no rules of their own start from the Operations rules, as Sales, Design, Renovation and Admin did.
INSERT INTO access_rules (scope, scope_id, area, level)
SELECT 'department', d.id, r.area, r.level
FROM departments d
JOIN access_rules r ON r.scope = 'department' AND r.scope_id = (SELECT o.id FROM departments o WHERE o.name = 'Operations')
WHERE d.kind = 'staff'
  AND NOT EXISTS (SELECT 1 FROM access_rules x WHERE x.scope = 'department' AND x.scope_id = d.id);

UPDATE users SET role = 'operations_staff', updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE role IN ('operations_manager', 'finance_admin');

INSERT INTO settings (key, value, updated_at)
SELECT 'security.require2faDepartments',
       COALESCE((
         SELECT string_agg(d.id, ',' ORDER BY d.sort, lower(d.name))
         FROM departments d
         WHERE EXISTS (
           SELECT 1 FROM unnest(string_to_array(s.value, ',')) AS r(role)
           WHERE (trim(r.role) = 'management'         AND d.kind = 'management')
              OR (trim(r.role) = 'operations_staff'   AND d.kind = 'staff')
              OR (trim(r.role) = 'finance_admin'      AND lower(trim(d.name)) = 'finance')
              OR (trim(r.role) = 'operations_manager' AND lower(trim(d.name)) = 'operations')
              OR (trim(r.role) = 'housekeeper'        AND d.kind = 'cleaning')
              OR (trim(r.role) = 'technician'         AND d.kind = 'maintenance'))
       ), ''),
       to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM settings s
WHERE s.key = 'security.require2faRoles' AND trim(s.value) <> ''
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value, updated_at)
SELECT 'security.require2faOwners',
       CASE WHEN EXISTS (SELECT 1 FROM unnest(string_to_array(s.value, ',')) AS r(role) WHERE trim(r.role) = 'owner') THEN 'true' ELSE 'false' END,
       to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM settings s
WHERE s.key = 'security.require2faRoles' AND trim(s.value) <> ''
ON CONFLICT (key) DO NOTHING;
