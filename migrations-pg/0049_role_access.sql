-- Editable permissions: what each office role may do in each area of the system, set by management on
-- Users and roles > Permissions. A row exists only where management has chosen a level; an area with no
-- row keeps the built-in rule for that role (functions/_lib/access.ts), so an empty table changes nothing.
-- Field roles, owners and management itself are not stored here: they are fixed.
-- REVERSAL: DROP TABLE role_access;
set local search_path = pos;

CREATE TABLE role_access (
  role       TEXT NOT NULL CHECK (role IN ('operations_manager','operations_staff','finance_admin')),
  area       TEXT NOT NULL,
  level      TEXT NOT NULL CHECK (level IN ('none','view','edit','full')),
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (role, area)
);
