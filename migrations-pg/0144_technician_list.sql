-- The technician list (Workers > Technicians, owner 23 Oct 2026). Until now a maintenance job's "who fixes it" was a
-- typed name, matched to a staff login by name (two logins with one name, and the job reached no phone) or kept as a
-- contractor name forever (one typo made a second contractor). The list works like the cleaner roster:
--
--   technicians                     in-house people (employment_type 'internal', optionally linked to a login) and
--                                   contractors ('outsourced', vendor_name is their company, never a login). Switching
--                                   one off keeps their jobs and takes them off the "who fixes it" list.
--   maintenance_issues.technician_id  the list entry a job is given to. vendor_name, assignee_kind and
--                                   assignee_user_id are kept in step, so every screen and the field app read as before.
--
-- Filled from what exists: every active technician login, every login a job was ever given to, and every contractor
-- name already used on a job (one entry per name, ignoring case and spaces). Jobs are then linked to their entry.
-- Optional: the code reads the list only when maintenance_issues.technician_id exists; without it, "who fixes it"
-- matches names as before.
--
-- REVERSAL: ALTER TABLE maintenance_issues DROP COLUMN technician_id; DROP TABLE technicians;
--           (vendor_name, assignee_kind and assignee_user_id still say who each job is with)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS technicians (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'internal' CHECK (employment_type IN ('internal','outsourced')),
  vendor_name     TEXT,
  phone           TEXT,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS technicians_user_id_key ON technicians(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS technicians_active_name_idx ON technicians(is_active, lower(trim(full_name)));

ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS technician_id TEXT REFERENCES technicians(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS maintenance_issues_technician_idx ON maintenance_issues(technician_id);

ALTER TABLE technicians OWNER TO pos_app;
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON technicians TO pos_app;

-- In-house: active technician logins, and any login a job was ever given to.
INSERT INTO technicians (id, full_name, employment_type, phone, user_id, is_active, created_at, updated_at)
SELECT 'tn-' || u.id, u.full_name, 'internal', u.phone, u.id, u.is_active,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM users u
WHERE (u.role = 'technician' AND u.is_active = 1)
   OR (u.role <> 'owner' AND EXISTS (SELECT 1 FROM maintenance_issues m WHERE m.assignee_user_id = u.id))
ON CONFLICT (id) DO NOTHING;

-- Contractors: each name used on a job that is not one of the in-house people above.
INSERT INTO technicians (id, full_name, employment_type, is_active, created_at, updated_at)
SELECT 'tn-c-' || md5(lower(trim(m.vendor_name))), min(trim(m.vendor_name)), 'outsourced', 1,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM maintenance_issues m
WHERE m.vendor_name IS NOT NULL AND trim(m.vendor_name) <> '' AND m.assignee_user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM technicians t WHERE lower(trim(t.full_name)) = lower(trim(m.vendor_name)))
GROUP BY lower(trim(m.vendor_name))
ON CONFLICT (id) DO NOTHING;

-- Link every job to its entry: by login when it has one, otherwise by name.
UPDATE maintenance_issues m SET technician_id = t.id
FROM technicians t
WHERE m.technician_id IS NULL AND m.assignee_user_id IS NOT NULL AND t.user_id = m.assignee_user_id;
UPDATE maintenance_issues m SET technician_id = (
  SELECT t.id FROM technicians t WHERE lower(trim(t.full_name)) = lower(trim(m.vendor_name)) ORDER BY t.employment_type, t.id LIMIT 1)
WHERE m.technician_id IS NULL AND m.vendor_name IS NOT NULL AND trim(m.vendor_name) <> '';
