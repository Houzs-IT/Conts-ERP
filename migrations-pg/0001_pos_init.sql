-- Property OS schema in Postgres (Supabase), converted from the D1/SQLite migrations
-- 0001-0003. Same table and column names and the same types on purpose (dates stay
-- ISO TEXT, flags stay INTEGER 0/1, money stays INTEGER sen) so the API's SQL keeps
-- working with only dialect fixes. Lives in its own schema, `pos`, apart from the
-- ERP backend's `app` schema.
-- REVERSAL: DROP SCHEMA pos CASCADE;

-- The API connects as its own role, pos_app, which owns only this schema. The role
-- is created here without a password; scripts/migrate-pg.mjs sets it from
-- POS_APP_PASSWORD. search_path is a role setting, so it survives connection pooling.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'pos_app') then create role pos_app login; end if;
end $$;
grant pos_app to current_user;
alter role pos_app set search_path = pos;
create schema if not exists pos authorization pos_app;
alter schema pos owner to pos_app;
set local search_path = pos;

-- ===== from migrations/0001_init.sql =====
-- The Conts Property OS — D1 schema
-- Converted from schema.sql (PostgreSQL). Three systematic changes:
--   1. enums          → TEXT + CHECK constraint, same closed vocabulary
--   2. money          → INTEGER sen. RM 12,450.00 === 1245000. Never REAL.
--   3. uuid/timestamp → TEXT. IDs from crypto.randomUUID(), times as ISO 8601 UTC.
-- The EXCLUDE constraint preventing double-booking has no SQLite equivalent and is
-- enforced in functions/api/reservations/index.ts — see the DATE_CONFLICT branch.


CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  email                TEXT NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  phone                TEXT,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('management','operations_manager','operations_staff','finance_admin','housekeeper','technician','owner')),
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  locale               TEXT NOT NULL DEFAULT 'en-MY',
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE owners (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  display_name       TEXT NOT NULL,
  legal_name         TEXT,
  email              TEXT NOT NULL,
  phone              TEXT,
  bank_name          TEXT,
  bank_account_last4 TEXT,
  bank_account_ref   TEXT,           -- encrypted at rest
  tax_id             TEXT,
  notes              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE owner_contracts (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  management_fee_pct DOUBLE PRECISION NOT NULL CHECK (management_fee_pct BETWEEN 0 AND 100),
  starts_on          TEXT NOT NULL,
  renews_on          TEXT,
  ends_on            TEXT,
  document_id        TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE properties (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  address_line TEXT NOT NULL,
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  postcode     TEXT,
  country_code TEXT NOT NULL DEFAULT 'MY',
  latitude     DOUBLE PRECISION,
  longitude    DOUBLE PRECISION,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE units (
  id            TEXT PRIMARY KEY,
  property_id   TEXT NOT NULL REFERENCES properties(id),
  owner_id      TEXT NOT NULL REFERENCES owners(id),
  contract_id   TEXT REFERENCES owner_contracts(id) ON DELETE SET NULL,
  unit_number   TEXT NOT NULL,
  bedrooms      INTEGER NOT NULL DEFAULT 1,
  bathrooms     INTEGER NOT NULL DEFAULT 1,
  max_guests    INTEGER NOT NULL DEFAULT 2,
  size_sqft     INTEGER,
  readiness     TEXT NOT NULL DEFAULT 'ready' CHECK (readiness IN ('occupied','dirty','cleaning','inspection','ready','maintenance','blocked')),
  base_rate     INTEGER NOT NULL,     -- sen
  is_listed     INTEGER NOT NULL DEFAULT 0,
  listed_at     TEXT,
  fitted_out_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (property_id, unit_number)
);
CREATE INDEX units_owner_idx ON units(owner_id);
CREATE INDEX units_readiness_idx ON units(readiness);

CREATE TABLE unit_channels (
  unit_id      TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('airbnb','booking_com','agoda','direct','maintenance_block','owner_stay')),
  external_ref TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (unit_id, channel)
);

CREATE TABLE guests (
  id           TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  email        TEXT,
  phone        TEXT,
  country_code TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE reservations (
  id                  TEXT PRIMARY KEY,
  unit_id             TEXT NOT NULL REFERENCES units(id),
  guest_id            TEXT REFERENCES guests(id) ON DELETE SET NULL,
  channel             TEXT NOT NULL CHECK (channel IN ('airbnb','booking_com','agoda','direct','maintenance_block','owner_stay')),
  external_ref        TEXT,
  state               TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('inquiry','pending','confirmed','checked_in','checked_out','cancelled','no_show')),
  check_in            TEXT NOT NULL,
  check_out           TEXT NOT NULL,
  check_in_time       TEXT NOT NULL DEFAULT '15:00',
  check_out_time      TEXT NOT NULL DEFAULT '11:00',
  guests_count        INTEGER NOT NULL DEFAULT 1,
  gross_booking_value INTEGER NOT NULL DEFAULT 0,  -- sen
  channel_fee         INTEGER NOT NULL DEFAULT 0,
  collected_revenue   INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'MYR',
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (check_out > check_in)
);
CREATE INDEX reservations_unit_dates_idx ON reservations(unit_id, check_in, check_out);
CREATE INDEX reservations_state_idx ON reservations(state);

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  unit_id        TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('turnover','deep_clean','light_clean','inspection','maintenance','delivery','other')),
  state          TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','assigned','in_progress','waiting','resolved','overdue','reopened')),
  title          TEXT NOT NULL,
  instructions   TEXT,
  assignee_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  scheduled_for  TEXT,
  due_at         TEXT,
  next_guest_at  TEXT,
  started_at     TEXT,
  completed_at   TEXT,
  completed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  requires_photo INTEGER NOT NULL DEFAULT 1,
  sync           TEXT NOT NULL DEFAULT 'synced' CHECK (sync IN ('queued','synced','failed')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX tasks_assignee_due_idx ON tasks(assignee_id, due_at);
CREATE INDEX tasks_state_due_idx ON tasks(state, due_at);

CREATE TABLE maintenance_issues (
  id                      TEXT PRIMARY KEY,
  unit_id                 TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reported_by             TEXT REFERENCES users(id) ON DELETE SET NULL,
  state                   TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','assigned','in_progress','waiting','resolved','overdue','reopened')),
  title                   TEXT NOT NULL,
  detail                  TEXT,
  vendor_name             TEXT,
  quoted_amount           INTEGER,
  final_amount            INTEGER,
  owner_approval_required INTEGER NOT NULL DEFAULT 0,
  owner_approved_at       TEXT,
  blocks_unit             INTEGER NOT NULL DEFAULT 0,
  blocked_from            TEXT,
  blocked_to              TEXT,
  charge_to               TEXT NOT NULL DEFAULT 'owner',
  reported_at             TEXT NOT NULL,
  resolved_at             TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE expenses (
  id             TEXT PRIMARY KEY,
  unit_id        TEXT NOT NULL REFERENCES units(id),
  maintenance_id TEXT REFERENCES maintenance_issues(id) ON DELETE SET NULL,
  task_id        TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  category       TEXT NOT NULL CHECK (category IN ('housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other')),
  description    TEXT NOT NULL,
  amount         INTEGER NOT NULL CHECK (amount >= 0),  -- sen
  currency       TEXT NOT NULL DEFAULT 'MYR',
  incurred_on    TEXT NOT NULL,
  reference      TEXT,
  charge_to      TEXT NOT NULL DEFAULT 'owner',
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX expenses_unit_date_idx ON expenses(unit_id, incurred_on);

CREATE TABLE owner_statements (
  id                  TEXT PRIMARY KEY,
  owner_id            TEXT NOT NULL REFERENCES owners(id),
  period_start        TEXT NOT NULL,
  period_end          TEXT NOT NULL,
  state               TEXT NOT NULL DEFAULT 'provisional' CHECK (state IN ('provisional','finalised','sent','paid')),
  gross_booking_value INTEGER NOT NULL DEFAULT 0,
  management_fee      INTEGER NOT NULL DEFAULT 0,
  expenses_total      INTEGER NOT NULL DEFAULT 0,
  adjustments_total   INTEGER NOT NULL DEFAULT 0,
  net_payout          INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'MYR',
  generated_at        TEXT NOT NULL,
  finalised_at        TEXT,
  sent_at             TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (owner_id, period_start, period_end)
);

CREATE TABLE statement_lines (
  id             TEXT PRIMARY KEY,
  statement_id   TEXT NOT NULL REFERENCES owner_statements(id) ON DELETE CASCADE,
  unit_id        TEXT REFERENCES units(id) ON DELETE SET NULL,
  reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL,
  expense_id     TEXT REFERENCES expenses(id) ON DELETE SET NULL,
  line_type      TEXT NOT NULL CHECK (line_type IN ('gross','management_fee','expense','adjustment')),
  category       TEXT,
  description    TEXT NOT NULL,
  occurred_on    TEXT NOT NULL,
  amount         INTEGER NOT NULL,   -- negative for deductions
  reference      TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE payouts (
  id             TEXT PRIMARY KEY,
  statement_id   TEXT NOT NULL REFERENCES owner_statements(id),
  owner_id       TEXT NOT NULL REFERENCES owners(id),
  amount         INTEGER NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'MYR',
  state          TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','paid','failed')),
  method         TEXT NOT NULL DEFAULT 'bank_transfer',
  bank_last4     TEXT,
  paid_at        TEXT,
  failure_reason TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE integrations (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL DEFAULT 'connected' CHECK (state IN ('connected','expired','degraded','failed')),
  last_synced_at TEXT,
  last_error     TEXT,
  credentials    TEXT              -- encrypted at rest
);

CREATE TABLE audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_table TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  before_state TEXT,
  after_state  TEXT,
  source       TEXT NOT NULL DEFAULT 'web',
  occurred_at  TEXT NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_log(entity_table, entity_id, occurred_at DESC);

-- ===== from migrations/0002_operations.sql =====
-- 0002 — tables the operations, growth and communication modules need.
-- Same conventions as 0001: TEXT ids, TEXT timestamps (ISO 8601 UTC),
-- INTEGER sen for money, enums as TEXT + CHECK.


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
  rating         DOUBLE PRECISION NOT NULL CHECK (rating BETWEEN 0 AND 5),
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

-- ===== from migrations/0003_settings.sql =====
-- 0003 — organisation settings as key/value, so adding a default does not
-- need a migration. Every key is documented in copy.md.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at) VALUES
 ('org.legal_name',            'The Conts Sdn Bhd', '2026-09-18T00:00:00Z'),
 ('org.company_number',        '202301027399 (1521322-V)', '2026-09-18T00:00:00Z'),
 ('org.address',               'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya', '2026-09-18T00:00:00Z'),
 ('org.support_phone',         '+60 17-465 8868', '2026-09-18T00:00:00Z'),
 ('locale.default',            'en-MY', '2026-09-18T00:00:00Z'),
 ('locale.timezone',           'Asia/Kuala_Lumpur', '2026-09-18T00:00:00Z'),
 ('locale.currency',           'MYR', '2026-09-18T00:00:00Z'),
 ('finance.default_fee_pct',   '25', '2026-09-18T00:00:00Z'),
 ('finance.statement_period',  'Calendar month, finalised on the 1st', '2026-09-18T00:00:00Z'),
 ('ops.check_in',              '15:00', '2026-09-18T00:00:00Z'),
 ('ops.check_out',             '11:00', '2026-09-18T00:00:00Z'),
 ('ops.turnover_sla_hours',    '4', '2026-09-18T00:00:00Z'),
 ('ops.photo_required',        'true', '2026-09-18T00:00:00Z');


-- pos_app owns every table (owners skip row-level security), so nothing in here is
-- reachable through Supabase's public API. RLS is still turned on, with no policies,
-- so that if the schema is ever exposed by mistake it returns nothing.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
