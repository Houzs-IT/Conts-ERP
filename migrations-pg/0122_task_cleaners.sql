-- Several cleaners on one cleaning job (owner request K2, 11 Oct 2026). Until now a clean had one cleaner: tasks.cleaner_id
-- (the roster entry) and tasks.assignee_id (that cleaner's login, empty for an outsourced crew). This table lists every
-- cleaner on the job; the two old columns are kept in step with the FIRST cleaner listed, so every screen and report
-- that reads them keeps working.
--
--   task_cleaners  one row per cleaner on a job. cleaner_id is the roster entry; user_id is the login the field app
--                  signs in with (the cleaner's own, empty for outsourced crews). A job assigned to a login with no
--                  roster entry (the old users-based path) has user_id only.
--
-- Optional: the code reads and writes the table only when it exists; without it a job has the one cleaner of the old
-- columns, as before. Backfilled from the old columns, so jobs assigned before this keep their cleaner.
--
-- REVERSAL: DROP TABLE task_cleaners;  (tasks.cleaner_id / assignee_id still hold the first cleaner of each job)
set local search_path = pos;

CREATE TABLE IF NOT EXISTS task_cleaners (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cleaner_id  TEXT REFERENCES cleaners(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  CHECK (cleaner_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS task_cleaners_task_cleaner_key ON task_cleaners(task_id, cleaner_id) WHERE cleaner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_cleaners_task_user_key ON task_cleaners(task_id, user_id) WHERE cleaner_id IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_cleaners_user_idx ON task_cleaners(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_cleaners_cleaner_idx ON task_cleaners(cleaner_id);

ALTER TABLE task_cleaners OWNER TO pos_app;
ALTER TABLE task_cleaners ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_cleaners TO pos_app;

-- Every job that has a cleaner today: the roster entry with its login, or the login alone (matched to that login's
-- roster entry when it has one).
INSERT INTO task_cleaners (id, task_id, cleaner_id, user_id, position, assigned_at, assigned_by)
SELECT 'tc-' || t.id, t.id, COALESCE(t.cleaner_id, (SELECT r.id FROM cleaners r WHERE r.user_id = t.assignee_id LIMIT 1)),
       COALESCE(t.assignee_id, c.user_id), 0, COALESCE(t.updated_at, t.created_at), NULL
FROM tasks t LEFT JOIN cleaners c ON c.id = t.cleaner_id
WHERE (t.cleaner_id IS NOT NULL OR t.assignee_id IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM task_cleaners x WHERE x.task_id = t.id);
