-- A repair job remembers which staff account it is assigned to (11 Oct 2026). Jobs name their technician by a typed
-- name (outside contractors are not accounts), and a technician's own job history was found by matching that name to
-- their account name, so renaming either side lost the link. Optional: the code reads and writes the column only
-- when it exists; without it, and for jobs assigned before it, the name match is used as before.
--
--   maintenance_issues.assignee_user_id  the active technician / housekeeper / operations account whose name was
--                                        assigned, when exactly one account has that name; empty for contractors.
--
-- REVERSAL: ALTER TABLE maintenance_issues DROP COLUMN assignee_user_id;
set local search_path = pos;

ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS assignee_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS maintenance_issues_assignee_user_idx ON maintenance_issues(assignee_user_id) WHERE assignee_user_id IS NOT NULL;
