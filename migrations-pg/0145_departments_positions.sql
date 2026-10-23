-- Permissions by department, position and user (PLAN.md, owner 23 Oct 2026). Step 1 of that plan: the tables, the seed
-- and the backfill. Nothing reads them yet; the live code still follows users.role and role_access.
--
-- * departments: a managed list. kind decides the hidden role (management, staff, cleaning, maintenance); side labels
--   the department The Conts, Dream Crafter or Both. A person's side becomes their department's side.
-- * positions: a managed list under each department.
-- * access_rules: what a department, a position or one user gets per area. area is an area key or 'group:<Category>'
--   for a category baseline. Replaces role_access, which is left untouched so the old chart can come back.
-- * users gains department_id, position_id and legacy_role. The text columns department and position stay and are kept
--   equal to the names, because the engine's pickers and public.conts_staff read them.
--
-- The seeded rules reproduce the category chart of functions/_lib/access.ts (GROUP_DEFAULTS and each area's defaults):
-- the Operations staff column for Operations, Sales, Design, Renovation and Admin; the Operations manager column as
-- position rules on Operations > Operations Manager; the Finance admin column for Finance. Only what is needed is
-- stored: a category or area left out resolves to No access, so the "none" baselines are not written. The 2 chosen
-- role_access rows on staging are not carried over (production has none).
--
-- users.role is NOT changed here. The live code still reads it, and operations_manager / finance_admin stay valid
-- roles until a later migration retires them once the code follows department and position.
--
-- Accounts: legacy_role = role first, then department / position by role (owners are left alone). An account in
-- operations_staff keeps its own department text when that names a staff department; the text "Management" (or any
-- other non-staff department) goes to Admin / Admin instead of Management, because Management means Full access
-- (PLAN.md open point 1). Position text on an account is kept when it names a position of the target department, or
-- is added there; "Operations Manager" is never taken from text, only from the operations_manager role, because that
-- position carries rules.
--
-- REVERSAL: update pos.users set role = legacy_role where legacy_role is not null;
--   alter table pos.users drop column department_id, drop column position_id, drop column legacy_role;
--   drop table pos.access_rules; drop table pos.positions; drop table pos.departments;
-- APPLY: needs 0143 (users.side) first. Staging first, then production from the "Apply migrations to production" action,
-- before the code that reads these tables goes live.
set local search_path = pos;

CREATE TABLE departments (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind       TEXT NOT NULL CHECK (kind IN ('management','staff','cleaning','maintenance')),
  side       TEXT NOT NULL DEFAULT 'both' CHECK (side IN ('conts','dream_crafter','both')),
  sort       INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE UNIQUE INDEX departments_name_unique ON departments (lower(name));

CREATE TABLE positions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  sort          INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at    TEXT NOT NULL DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX positions_department_idx ON positions (department_id);
CREATE UNIQUE INDEX positions_name_unique ON positions (department_id, lower(name));

-- scope_id points at departments.id, positions.id or users.id by scope, so it carries no foreign key: the delete
-- handlers remove a scope's rules with it.
CREATE TABLE access_rules (
  scope      TEXT NOT NULL CHECK (scope IN ('department','position','user')),
  scope_id   TEXT NOT NULL,
  area       TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('none','view','edit','full','inherit')),
  updated_at TEXT NOT NULL DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_by TEXT,
  PRIMARY KEY (scope, scope_id, area)
);

ALTER TABLE users
  ADD COLUMN department_id TEXT REFERENCES departments(id),
  ADD COLUMN position_id   TEXT REFERENCES positions(id),
  ADD COLUMN legacy_role   TEXT;
CREATE INDEX users_department_id_idx ON users (department_id);
CREATE INDEX users_position_id_idx ON users (position_id);

-- Departments and their positions. Sides are a starting guess; management changes them on the list screen.
INSERT INTO departments (name, kind, side, sort) VALUES
  ('Management',  'management',  'both',          10),
  ('Operations',  'staff',       'conts',         20),
  ('Finance',     'staff',       'both',          30),
  ('Sales',       'staff',       'dream_crafter', 40),
  ('Design',      'staff',       'dream_crafter', 50),
  ('Renovation',  'staff',       'dream_crafter', 60),
  ('Admin',       'staff',       'both',          70),
  ('Cleaning',    'cleaning',    'conts',         80),
  ('Maintenance', 'maintenance', 'conts',         90);

INSERT INTO positions (department_id, name, sort)
SELECT d.id, p.name, p.sort
FROM (VALUES
  ('Management',  'Director',           10),
  ('Operations',  'Operations Manager', 10),
  ('Operations',  'Operations Staff',   20),
  ('Finance',     'Finance Admin',      10),
  ('Sales',       'Sales Executive',    10),
  ('Design',      'Interior Designer',  10),
  ('Design',      '3D Designer',        20),
  ('Design',      '2D Drafter',         30),
  ('Renovation',  'Project PIC',        10),
  ('Renovation',  'Site Supervisor',    20),
  ('Admin',       'Admin',              10),
  ('Cleaning',    'Cleaner',            10),
  ('Maintenance', 'Technician',         10)
) AS p(dept, name, sort)
JOIN departments d ON d.name = p.dept;

-- Any other free-text department already on an account is added too, so nobody loses theirs. Owners are not staff.
INSERT INTO departments (name, kind, side, sort)
SELECT x.d, 'staff', 'both', 100 + (row_number() OVER (ORDER BY lower(x.d)))::int
FROM (
  SELECT DISTINCT ON (lower(s.d)) s.d
  FROM (SELECT regexp_replace(trim(u.department), '\s+', ' ', 'g') AS d FROM users u WHERE u.role <> 'owner') s
  WHERE s.d <> ''
  ORDER BY lower(s.d), s.d
) x
WHERE NOT EXISTS (SELECT 1 FROM departments e WHERE lower(e.name) = lower(x.d));

-- Where each account lands.
CREATE TEMP TABLE _u ON COMMIT DROP AS
SELECT u.id, u.role,
       nullif(regexp_replace(trim(u.department), '\s+', ' ', 'g'), '') AS dtext,
       nullif(regexp_replace(trim(u."position"), '\s+', ' ', 'g'), '') AS ptext,
       NULL::text AS dept_name, NULL::text AS dept_id, NULL::text AS pos_id
FROM users u WHERE u.role <> 'owner';

UPDATE _u SET dept_name = CASE role
  WHEN 'management'         THEN 'Management'
  WHEN 'operations_manager' THEN 'Operations'
  WHEN 'finance_admin'      THEN 'Finance'
  WHEN 'housekeeper'        THEN 'Cleaning'
  WHEN 'technician'         THEN 'Maintenance'
  ELSE CASE
    WHEN dtext IS NULL THEN 'Operations'
    WHEN EXISTS (SELECT 1 FROM departments d WHERE lower(d.name) = lower(_u.dtext) AND d.kind = 'staff') THEN dtext
    ELSE 'Admin'
  END
END;
UPDATE _u SET dept_id = d.id FROM departments d WHERE lower(d.name) = lower(_u.dept_name);

-- Any other free-text position is added under the department the account lands in.
INSERT INTO positions (department_id, name, sort)
SELECT x.dept_id, x.ptext, 100 + (row_number() OVER (ORDER BY x.dept_id, lower(x.ptext)))::int
FROM (
  SELECT DISTINCT ON (t.dept_id, lower(t.ptext)) t.dept_id, t.ptext
  FROM _u t WHERE t.ptext IS NOT NULL AND lower(t.ptext) <> 'operations manager'
  ORDER BY t.dept_id, lower(t.ptext), t.ptext
) x
WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.department_id = x.dept_id AND lower(p.name) = lower(x.ptext));

UPDATE _u SET pos_id = p.id FROM positions p
WHERE p.department_id = _u.dept_id AND lower(p.name) = lower(_u.ptext)
  AND NOT (p.name = 'Operations Manager' AND _u.role <> 'operations_manager');

-- No usable position text: the role's own position. Staff in other departments simply have none (it is optional).
UPDATE _u SET pos_id = p.id FROM positions p
WHERE _u.pos_id IS NULL AND p.department_id = _u.dept_id
  AND p.name = CASE _u.role
    WHEN 'management'         THEN 'Director'
    WHEN 'operations_manager' THEN 'Operations Manager'
    WHEN 'finance_admin'      THEN 'Finance Admin'
    WHEN 'housekeeper'        THEN 'Cleaner'
    WHEN 'technician'         THEN 'Technician'
    ELSE CASE _u.dept_name WHEN 'Operations' THEN 'Operations Staff' WHEN 'Admin' THEN 'Admin' END
  END;

UPDATE users SET legacy_role = role;
UPDATE users u SET department_id = t.dept_id, position_id = t.pos_id, department = d.name, "position" = p.name,
                   side = CASE WHEN d.kind = 'management' THEN 'both' ELSE d.side END
FROM _u t JOIN departments d ON d.id = t.dept_id LEFT JOIN positions p ON p.id = t.pos_id
WHERE u.id = t.id;

-- Rules. Operations staff column: Operations, Sales, Design, Renovation and Admin.
INSERT INTO access_rules (scope, scope_id, area, level)
SELECT 'department', d.id, r.area, r.level
FROM departments d
JOIN (VALUES
  ('group:Operations',    'edit'),
  ('group:Dream Crafter', 'edit'),
  ('group:Growth',        'edit'),
  ('scInvoices',          'none')
) AS r(area, level) ON true
WHERE d.name IN ('Operations', 'Sales', 'Design', 'Renovation', 'Admin');

-- Finance admin column: the Finance department.
INSERT INTO access_rules (scope, scope_id, area, level)
SELECT 'department', d.id, r.area, r.level
FROM departments d
JOIN (VALUES
  ('group:Workspace',     'view'),
  ('group:Operations',    'view'),
  ('group:Dream Crafter', 'view'),
  ('group:Finance',       'full'),
  ('group:Growth',        'full'),
  ('group:System',        'full'),
  ('scInvoices',          'full'),
  ('comms',               'none'),
  ('users',               'none')
) AS r(area, level) ON true
WHERE d.name = 'Finance';

-- Operations manager column: the Operations Manager position.
INSERT INTO access_rules (scope, scope_id, area, level)
SELECT 'position', p.id, r.area, r.level
FROM positions p
JOIN departments d ON d.id = p.department_id AND d.name = 'Operations'
JOIN (VALUES
  ('group:Workspace',     'full'),
  ('group:Operations',    'full'),
  ('group:Dream Crafter', 'full'),
  ('group:Finance',       'view'),
  ('group:Growth',        'full'),
  ('group:System',        'full'),
  ('scInvoices',          'view'),
  ('ledger',              'none')
) AS r(area, level) ON true
WHERE p.name = 'Operations Manager';

-- Hand-over to the API's role, row level security on (same as 0049 and 0050). Last, so the inserts above run as the
-- migration's own role whatever its row security setting.
ALTER TABLE departments  OWNER TO pos_app;
ALTER TABLE positions    OWNER TO pos_app;
ALTER TABLE access_rules OWNER TO pos_app;
ALTER TABLE departments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_rules ENABLE ROW LEVEL SECURITY;
