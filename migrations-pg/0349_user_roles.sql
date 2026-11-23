-- 0349_user_roles: a desk account can hold extra roles on top of its own department and position.
--
-- A role is a position (which sits in a department). users.department_id / position_id stay the person's main role,
-- read as before by sign-in, view-as, the field app and the org chart. This table holds only the extra ones; access is
-- the highest level any of the person's roles gives, area by area (functions/_lib/access.ts resolveFor).
-- Extra roles are desk (staff) positions only: Management is Full already, Cleaning and Maintenance logins stay one role.
--
-- The product category view (0176) now reads every department the person holds: no limit if any of them has none,
-- otherwise the union of what they allow. A person-level limit still replaces them all.
--
-- REVERSAL:
--   create or replace view public.conts_category_access as <the 0176 definition>;
--   drop table pos.user_roles;
--   select demo.sync();

set local search_path = pos;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS user_roles (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, position_id)
);
CREATE INDEX IF NOT EXISTS user_roles_position_idx ON user_roles (position_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO pos_app;
ALTER TABLE user_roles OWNER TO pos_app;

CREATE OR REPLACE VIEW public.conts_category_access AS
  SELECT lower(u.email) AS email, a.group_code, a.sub_code
    FROM pos.person_category_access a
    JOIN pos.users u ON u.id = a.user_id
  UNION
  SELECT lower(u.email), d.group_code, d.sub_code
    FROM pos.users u
    JOIN (SELECT u2.id AS user_id, u2.department_id FROM pos.users u2 WHERE u2.department_id IS NOT NULL
          UNION
          SELECT r.user_id, p.department_id FROM pos.user_roles r JOIN pos.positions p ON p.id = r.position_id) held ON held.user_id = u.id
    JOIN pos.department_category_access d ON d.department_id = held.department_id
   WHERE NOT EXISTS (SELECT 1 FROM pos.person_category_access p WHERE p.user_id = u.id)
     AND NOT EXISTS (
       SELECT 1 FROM (SELECT u.department_id AS department_id
                      UNION
                      SELECT p2.department_id FROM pos.user_roles r2 JOIN pos.positions p2 ON p2.id = r2.position_id WHERE r2.user_id = u.id) h
        WHERE h.department_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM pos.department_category_access x WHERE x.department_id = h.department_id));

REVOKE ALL ON public.conts_category_access FROM public, anon, authenticated;
GRANT SELECT ON public.conts_category_access TO scm_engine;

select demo.sync();
