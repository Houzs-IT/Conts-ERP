-- 0002 — tables the operations, growth and communication modules need.
-- Same conventions as 0001: TEXT ids, TEXT timestamps (ISO 8601 UTC),
-- INTEGER sen for money, enums as TEXT + CHECK.

PRAGMA foreign_keys = ON;

CREATE TABLE inspections (
  id           TEXT PRIMARY KEY,
  unit_id      TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  inspector_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  state        TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','assigned','in_progress','waiting','resolved','overdue','reopened')),
  passed       INTEGER,                       -- NULL until submitted
  checklist    TEXT NOT NULL DEFAULT '[]',    -- JSON: [{item, ok, note}]
  notes        TEXT,
  inspected_at TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX inspections_unit_idx ON inspections(unit_id, inspected_at DESC);

CREATE TABLE inventory_items (
  id                TEXT PRIMARY KEY,
  unit_id           TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  quantity          TEXT NOT NULL DEFAULT '1',
  condition         TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','fair','replace_soon','damaged')),
  supplied_in_house INTEGER NOT NULL DEFAULT 1,   -- The Conts furniture arm
  purchase_cost     INTEGER,                      -- sen
  installed_on      TEXT,
  last_checked      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX inventory_unit_idx ON inventory_items(unit_id);

CREATE TABLE access_credentials (
  id                 TEXT PRIMARY KEY,
  unit_id            TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL,   -- smart_lock | key_box | guard_desk | lift_card
  label              TEXT NOT NULL,
  secret             TEXT,            -- ENCRYPTED AT REST. Masked in every response
                                      -- unless an operations or management role asks
                                      -- explicitly, and that reveal is audited.
  instruction        TEXT NOT NULL,   -- safe to show guests and field staff
  rotates_after_stay INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL
);
CREATE INDEX access_unit_idx ON access_credentials(unit_id);

CREATE TABLE reviews (
  id             TEXT PRIMARY KEY,
  unit_id        TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  channel        TEXT NOT NULL CHECK (channel IN ('airbnb','booking_com','agoda','direct','maintenance_block','owner_stay')),
  rating         REAL NOT NULL CHECK (rating BETWEEN 0 AND 5),
  comment        TEXT,
  replied_at     TEXT,
  reviewed_at    TEXT NOT NULL
);
CREATE INDEX reviews_unit_idx ON reviews(unit_id, reviewed_at DESC);

CREATE TABLE pricing_rules (
  id           TEXT PRIMARY KEY,
  unit_id      TEXT REFERENCES units(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  starts_on    TEXT,
  ends_on      TEXT,
  weekday_rate INTEGER,    -- sen
  weekend_rate INTEGER,
  min_nights   INTEGER,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE message_threads (
  id              TEXT PRIMARY KEY,
  reservation_id  TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id        TEXT REFERENCES guests(id) ON DELETE SET NULL,
  owner_id        TEXT REFERENCES owners(id) ON DELETE SET NULL,
  channel         TEXT CHECK (channel IN ('airbnb','booking_com','agoda','direct','maintenance_block','owner_stay')),
  subject         TEXT,
  is_read         INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL
);
CREATE INDEX threads_recent_idx ON message_threads(last_message_at DESC);

CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  direction    TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  body         TEXT NOT NULL,
  sent_at      TEXT NOT NULL,
  is_automated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX messages_thread_idx ON messages(thread_id, sent_at);

CREATE TABLE automations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  trigger      TEXT NOT NULL,      -- e.g. 'reservation.confirmed'
  offset_hours INTEGER,            -- negative = before the trigger
  template     TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE documents (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,   -- statement | invoice | contract | photo | payout_advice
  file_name        TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  byte_size        INTEGER NOT NULL,
  storage_key      TEXT NOT NULL,   -- R2 object key
  unit_id          TEXT REFERENCES units(id) ON DELETE CASCADE,
  owner_id         TEXT REFERENCES owners(id) ON DELETE CASCADE,
  task_id          TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  maintenance_id   TEXT REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  statement_id     TEXT REFERENCES owner_statements(id) ON DELETE CASCADE,
  visible_to_owner INTEGER NOT NULL DEFAULT 0,
  photographer     TEXT,            -- rights metadata, per the brand guide
  rights_note      TEXT,
  captured_at      TEXT,
  uploaded_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX documents_task_idx ON documents(task_id, kind);
CREATE INDEX documents_statement_idx ON documents(statement_id);

CREATE TABLE notification_log (
  id                  TEXT PRIMARY KEY,
  template            TEXT NOT NULL,
  recipient           TEXT NOT NULL,
  channel             TEXT NOT NULL,   -- email | whatsapp | push | in_app
  entity_table        TEXT,
  entity_id           TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  state               TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sent','failed')),
  error               TEXT,
  queued_at           TEXT NOT NULL,
  sent_at             TEXT
);

CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE,
  screen     TEXT NOT NULL,       -- 'operations.today'
  name       TEXT NOT NULL,
  filters    TEXT NOT NULL,       -- JSON
  is_shared  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
