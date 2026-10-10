-- In-app notifications, outbox retry and the link from a calendar block to the repair job that made it
-- (10 Oct 2026). Every change is additive.
--
--   user_notifications                 one row per person per notice: the bell in the top bar and the
--                                      Notifications page read only the signed-in person's rows.
--                                      kind       what happened, e.g. booking.created, cleaning.assigned
--                                      link       the in-app path the notice opens (e.g. /operations/cleaning?task=..)
--                                      dedupe_key the same event never notifies one person twice (a retried
--                                                 request, the hourly overdue sweep running again)
--   notification_log.attempts          how many times the email / WhatsApp copy was tried; the scheduled job
--   notification_log.next_attempt_at   retries a failed send with a growing wait and stops after 5 tries
--   reservations.maintenance_issue_id  the repair job a calendar block was made for ("Block unit until fixed"),
--                                      so the block is released as soon as the job is closed. A block made
--                                      before this column existed is found by the note that button writes
--                                      ("Maintenance: <job title>") on the same unit (functions/_lib/repairBlocks.ts).
--
-- REVERSAL:
--   DROP TABLE user_notifications;
--   ALTER TABLE notification_log DROP COLUMN attempts, DROP COLUMN next_attempt_at;
--   ALTER TABLE reservations DROP COLUMN maintenance_issue_id;
set local search_path = pos;

CREATE TABLE user_notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,
  entity_table TEXT,
  entity_id    TEXT,
  dedupe_key   TEXT,
  read_at      TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX user_notifications_user_idx ON user_notifications(user_id, created_at DESC);
CREATE INDEX user_notifications_unread_idx ON user_notifications(user_id) WHERE read_at IS NULL;
ALTER TABLE user_notifications OWNER TO pos_app;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification_log ADD COLUMN attempts        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_log ADD COLUMN next_attempt_at TEXT;

ALTER TABLE reservations ADD COLUMN maintenance_issue_id TEXT REFERENCES maintenance_issues(id) ON DELETE SET NULL;
CREATE INDEX reservations_maintenance_issue_idx ON reservations(maintenance_issue_id) WHERE maintenance_issue_id IS NOT NULL;
