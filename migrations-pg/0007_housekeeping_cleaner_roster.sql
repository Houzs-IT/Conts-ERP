-- Housekeeping cleaner roster + auto-assign rules.
--
-- The roster is master data the operator maintains: who can be assigned a clean,
-- split by employment dimension — INTERNAL staff vs OUTSOURCED / third-party.
-- Internal cleaners link to a users row (they log in as housekeepers); outsourced
-- cleaners are roster-only (a third-party company, no login), so they cannot be
-- users rows. tasks.cleaner_id records which roster entry a clean is given to,
-- alongside the existing assignee_id (kept for internal-staff notifications and
-- the field app). Auto-assign preferences live in settings.
--
-- REVERSAL:
--   ALTER TABLE tasks DROP COLUMN cleaner_id;
--   DROP TABLE cleaners;
--   DELETE FROM settings WHERE key IN ('housekeeping.assign_strategy','housekeeping.assign_prefer');
set local search_path = pos;

CREATE TABLE cleaners (
  id              TEXT PRIMARY KEY,
  full_name       TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'internal' CHECK (employment_type IN ('internal','outsourced')),
  vendor_name     TEXT,                                   -- the third-party company, for outsourced
  phone           TEXT,
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,  -- the login account, internal only
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX cleaners_active_idx ON cleaners(is_active, employment_type);
CREATE UNIQUE INDEX cleaners_user_id_key ON cleaners(user_id) WHERE user_id IS NOT NULL;

-- Which roster entry a clean is assigned to. assignee_id stays the source of truth
-- for the field app / notifications; cleaner_id is set in step with it for internal
-- staff and stands alone for an outsourced crew.
ALTER TABLE tasks ADD COLUMN cleaner_id TEXT REFERENCES cleaners(id) ON DELETE SET NULL;
CREATE INDEX tasks_cleaner_idx ON tasks(cleaner_id);

-- Seed the roster from the current housekeeper staff so the operator starts with
-- their real crew as internal cleaners, each linked to its login account.
INSERT INTO cleaners (id, full_name, employment_type, vendor_name, phone, user_id, is_active, created_at, updated_at)
SELECT 'cl-' || u.id, u.full_name, 'internal', NULL, u.phone, u.id, u.is_active,
       to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM users u
WHERE u.role = 'housekeeper'
ON CONFLICT (id) DO NOTHING;

-- Auto-assign preferences the rules editor maintains.
INSERT INTO settings (key, value, updated_at) VALUES
 ('housekeeping.assign_strategy', 'least_loaded', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
 ('housekeeping.assign_prefer',   'any',          to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
