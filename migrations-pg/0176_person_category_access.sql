-- REVERSAL: drop view public.conts_category_access; drop table pos.person_category_access; drop table pos.department_category_access;
-- Product category access per department and per person (Renovation beta project screens, plan PLAN-category-rbac.md v2, phase 1).
-- Set on the Conts side (Dream Crafter workspace, System, Category access); the engine reads it live by email.
--
-- * pos.person_category_access: one row per ticked group or sub-category for a person. A person with no rows sees every
--   category, so applying this changes nothing until management ticks boxes. A person with rows sees only the ticked
--   groups and sub-categories: sub_code null means the whole group, group_code 'OTHER' means products with no category.
--   No foreign key to the scm category tables (the Conts functions cannot read schema scm, and the 'OTHER' sentinel would
--   break it); the Conts handler checks the codes against its own copy of the catalog.
-- * pos.department_category_access: the same shape for a department. Everyone in the department gets it, unless the
--   person has rows of their own: a person's own setting replaces their department's, it does not add to it.
-- * public.conts_category_access: email (lower case), group_code, sub_code, already resolved that way. Like public.conts_staff (migration 0113) it is
--   all the engine's role (scm_engine) may read of this table, and it runs with its owner's rights.
--
-- APPLY: by hand, local, then staging, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- The engine treats a missing view as "no restriction" and warns, so either side may deploy first.
set local search_path = pos;

CREATE TABLE person_category_access (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_code TEXT NOT NULL,
  sub_code   TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX person_category_access_uq ON person_category_access (user_id, group_code, coalesce(sub_code, ''));

CREATE TABLE department_category_access (
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_code    TEXT NOT NULL,
  sub_code      TEXT,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX department_category_access_uq ON department_category_access (department_id, group_code, coalesce(sub_code, ''));

CREATE VIEW public.conts_category_access AS
  SELECT lower(u.email) AS email, a.group_code, a.sub_code
    FROM pos.person_category_access a
    JOIN pos.users u ON u.id = a.user_id
  UNION ALL
  SELECT lower(u.email), d.group_code, d.sub_code
    FROM pos.department_category_access d
    JOIN pos.users u ON u.department_id = d.department_id
   WHERE NOT EXISTS (SELECT 1 FROM pos.person_category_access p WHERE p.user_id = u.id);

-- Hand-over to the API's role, row level security on (same as 0145).
ALTER TABLE person_category_access OWNER TO pos_app;
ALTER TABLE person_category_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_category_access OWNER TO pos_app;
ALTER TABLE department_category_access ENABLE ROW LEVEL SECURITY;

-- Same grants as public.conts_staff (0113): the engine's role only.
REVOKE ALL ON public.conts_category_access FROM public, anon, authenticated;
GRANT SELECT ON public.conts_category_access TO scm_engine;
