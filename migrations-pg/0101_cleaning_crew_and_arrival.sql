-- Cleaning: several cleaners on one cleaning job, and the next guest's expected arrival time (owner, 11 Oct 2026).
-- Additive only.
--
--   task_cleaners                  who is on a cleaning job: one row per cleaner (cleaners roster, internal or
--                                  outsourced). No lead: every row is equal. tasks.cleaner_id and tasks.assignee_id
--                                  stay and are kept in step by the API (functions/_lib/ops.ts setCleaners): the
--                                  first cleaner by time added, and the first one with a login, so screens and
--                                  checks that read the single columns keep working.
--   reservations.expected_arrival  HH:MM the arriving guest said they will come, typed by staff. Separate from
--                                  check_in_time (the agreed check-in, 15:00 by default). Cleaning's "clean by"
--                                  and time left use it when set.
--
-- Backfill: every task with a cleaner_id gets that cleaner; a task with only assignee_id gets the roster cleaner
-- linked to that login, when there is one.
--
-- REVERSAL:
--   DROP TABLE task_cleaners;
--   ALTER TABLE reservations DROP COLUMN expected_arrival;
set local search_path = pos;

CREATE TABLE task_cleaners (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cleaner_id  TEXT NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (task_id, cleaner_id)
);
CREATE INDEX task_cleaners_cleaner_idx ON task_cleaners(cleaner_id);
ALTER TABLE task_cleaners OWNER TO pos_app;
ALTER TABLE task_cleaners ENABLE ROW LEVEL SECURITY;

INSERT INTO task_cleaners (task_id, cleaner_id, assigned_at)
SELECT t.id, t.cleaner_id, COALESCE(t.updated_at, t.created_at) FROM tasks t WHERE t.cleaner_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO task_cleaners (task_id, cleaner_id, assigned_at)
SELECT t.id, c.id, COALESCE(t.updated_at, t.created_at)
FROM tasks t JOIN cleaners c ON c.user_id = t.assignee_id
WHERE t.cleaner_id IS NULL AND t.assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE reservations ADD COLUMN expected_arrival TEXT
  CHECK (expected_arrival IS NULL OR expected_arrival ~ '^([01]\d|2[0-3]):[0-5]\d$');
