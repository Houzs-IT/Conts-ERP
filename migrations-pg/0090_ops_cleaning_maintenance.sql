-- Operations rework (Cleaning and Maintenance screens, 10 Oct 2026). Every change is additive.
--
--   tasks.guest_left_at                 when the departing guest was seen to leave (the "Guest left" action on a
--                                       clean). A booking moved to Checked out counts too; this records the moment
--                                       for a clean whose booking was never checked in on the system.
--   task_checklist_items                the ticks on one clean's checklist. The standard list lives in code; a row
--                                       exists only once an item was ticked or added by hand.
--   maintenance_issues.category         plumbing | electrical | aircon | furniture | appliance | other
--   maintenance_issues.urgency          normal | urgent
--   maintenance_issues.source           who reported it: guest | cleaner | inspection | staff
--   maintenance_issues.source_task_id   the clean the damage was reported from, when it came from one
--   maintenance_issues.assignee_kind    in_house | contractor (vendor_name keeps the name)
--   maintenance_windows                 times a technician may enter the unit (between guests, or a slot the guest
--                                       agreed); shown on the job, Cleaning and Today, and checked against stays
--
-- Who pays a repair is expenses.charge_to / maintenance_issues.charge_to (owner | the_conts | guest_deposit |
-- warranty), already present: no new payer column.
--
-- REVERSAL:
--   DROP TABLE maintenance_windows; DROP TABLE task_checklist_items; ALTER TABLE tasks DROP COLUMN guest_left_at;
--   ALTER TABLE maintenance_issues DROP COLUMN category, DROP COLUMN urgency, DROP COLUMN source,
--     DROP COLUMN source_task_id, DROP COLUMN assignee_kind;
set local search_path = pos;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS guest_left_at TEXT;

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- 'std-<n>' for an item of the standard list, 'c-<uuid>' for one added by hand.
  item_key    TEXT NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT,
  done_by     TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (task_id, item_key)
);
CREATE INDEX IF NOT EXISTS task_checklist_items_task ON task_checklist_items(task_id);

ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('plumbing','electrical','aircon','furniture','appliance','other'));
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS urgency TEXT NOT NULL DEFAULT 'normal'
  CHECK (urgency IN ('normal','urgent'));
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff'
  CHECK (source IN ('guest','cleaner','inspection','staff'));
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS assignee_kind TEXT
  CHECK (assignee_kind IS NULL OR assignee_kind IN ('in_house','contractor'));

CREATE TABLE IF NOT EXISTS maintenance_windows (
  id          TEXT PRIMARY KEY,
  issue_id    TEXT NOT NULL REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  -- ISO instants with the +08:00 offset, like tasks.scheduled_for.
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  note        TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS maintenance_windows_issue ON maintenance_windows(issue_id);
CREATE INDEX IF NOT EXISTS maintenance_windows_start ON maintenance_windows(starts_at);
