-- Retires the office roles operations_manager and finance_admin (PLAN.md, owner 23 Oct 2026). What made them different
-- now lives in rules: the Operations Manager position and the Finance department (migration 0145). Run it when the code
-- that reads departments and positions deploys, not before: until then the live code still branches on these roles.
--
-- * users.role becomes operations_staff for both. legacy_role (0145) keeps the old value, so nothing is lost.
-- * The CHECK on users.role is left as it is. Both retired values stay valid so the reversal below can put them back.
-- * Two-step sign-in is saved by department now (security.require2faDepartments, department ids). The old list of roles
--   is copied across: finance_admin -> Finance, operations_manager -> Operations, management -> Management. The old
--   setting is left in place; the code reads it only while the new one does not exist.
--
-- REVERSAL: update pos.users set role = legacy_role where legacy_role in ('operations_manager','finance_admin');
--   delete from pos.settings where key = 'security.require2faDepartments';
-- APPLY: needs 0145 first. Staging first, then production from the "Apply migrations to production" action together
-- with the deploy of the code that follows departments.
set local search_path = pos;

-- Make sure the old role is on record before it is overwritten (0145 already did this for every non-owner).
UPDATE users SET legacy_role = role
WHERE legacy_role IS NULL AND role IN ('operations_manager', 'finance_admin');

UPDATE users SET role = 'operations_staff', updated_at = to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE role IN ('operations_manager', 'finance_admin');

INSERT INTO settings (key, value, updated_at)
SELECT 'security.require2faDepartments',
       COALESCE((
         SELECT string_agg(d.id, ',' ORDER BY d.sort)
         FROM departments d
         WHERE d.name IN (
           SELECT CASE trim(r) WHEN 'finance_admin' THEN 'Finance' WHEN 'operations_manager' THEN 'Operations' WHEN 'management' THEN 'Management' END
           FROM unnest(string_to_array(s.value, ',')) AS r)
       ), ''),
       to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM settings s
WHERE s.key = 'security.require2faRoles' AND trim(s.value) <> ''
ON CONFLICT (key) DO NOTHING;
