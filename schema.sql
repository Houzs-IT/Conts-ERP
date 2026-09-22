-- The Conts Property OS — database schema
-- Source of truth for status vocabulary: The Conts Digital Brand Guide v1.0, section 11.
-- Every enum below is closed. Do NOT add synonyms (Complete / Completed / Done) — guide 11.
-- Timezone: all timestamps stored UTC (timestamptz), presented Asia/Kuala_Lumpur.
-- Money: numeric(12,2) in MYR minor-unit-safe decimal, never float.
-- Target: PostgreSQL 14+.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================================
-- ENUMS — status taxonomy (guide 11)
-- =====================================================================

-- 11.1 Reservation
CREATE TYPE reservation_state AS ENUM (
  'inquiry',      -- no confirmed reservation            | neutral
  'pending',      -- awaiting payment or confirmation    | warning
  'confirmed',    -- reservation accepted                | info
  'checked_in',   -- guest currently occupying unit      | success
  'checked_out',  -- stay completed                      | neutral
  'cancelled',    -- reservation cancelled               | neutral, critical when action required
  'no_show'       -- guest did not arrive                | critical
);

-- 11.2 Unit readiness
CREATE TYPE unit_readiness AS ENUM (
  'occupied',     -- current guest in unit               | info
  'dirty',        -- checkout done, cleaning not started | warning
  'cleaning',     -- cleaning in progress                | info
  'inspection',   -- awaiting or undergoing QC           | warning
  'ready',        -- approved for check-in               | success
  'maintenance',  -- unavailable due to maintenance      | critical
  'blocked'       -- unavailable by rule or manual block | neutral
);

-- 11.3 Task and issue
CREATE TYPE task_state AS ENUM (
  'open',         -- unassigned or not started           | neutral
  'assigned',     -- owner established                   | info
  'in_progress',  -- work underway                       | info
  'waiting',      -- blocked by guest, vendor or approval| warning
  'resolved',     -- outcome completed                   | success
  'overdue',      -- past committed time                 | critical
  'reopened'      -- returned after resolution           | critical
);

-- Channels (guide 14.4 — must be distinguishable without colour)
CREATE TYPE booking_channel AS ENUM (
  'airbnb', 'booking_com', 'agoda', 'direct', 'maintenance_block', 'owner_stay'
);

CREATE TYPE statement_state AS ENUM ('provisional', 'finalised', 'sent', 'paid');
CREATE TYPE payout_state AS ENUM ('pending', 'processing', 'paid', 'failed');
CREATE TYPE user_role AS ENUM (
  'management', 'operations_manager', 'operations_staff', 'finance_admin',
  'housekeeper', 'technician', 'owner'
);
CREATE TYPE task_kind AS ENUM ('turnover', 'deep_clean', 'light_clean', 'inspection', 'maintenance', 'delivery', 'other');
CREATE TYPE item_condition AS ENUM ('good', 'fair', 'replace_soon', 'damaged');
CREATE TYPE expense_category AS ENUM (
  'housekeeping', 'maintenance', 'utilities', 'consumables', 'furniture',
  'management_fee', 'channel_fee', 'other'
);
CREATE TYPE sync_state AS ENUM ('queued', 'synced', 'failed');          -- offline field work (guide 9.3)
CREATE TYPE integration_state AS ENUM ('connected', 'expired', 'degraded', 'failed'); -- guide 19

-- =====================================================================
-- IDENTITY AND ACCESS (guide 19 — least privilege)
-- =====================================================================

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 citext NOT NULL UNIQUE,
  full_name             text NOT NULL,
  phone                 text,
  password_hash         text NOT NULL,
  role                  user_role NOT NULL,
  must_change_password  boolean NOT NULL DEFAULT true,   -- forces /change-password on first sign-in
  failed_attempts       smallint NOT NULL DEFAULT 0,     -- lockout after 5 (see auth spec)
  locked_until          timestamptz,
  last_login_at         timestamptz,
  locale                text NOT NULL DEFAULT 'en-MY',
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_reset_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,                      -- 60 minutes from issue
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent  text,
  ip          inet,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- OWNERS AND CONTRACTS
-- =====================================================================

CREATE TABLE owners (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL, -- portal login, nullable
  display_name    text NOT NULL,
  legal_name      text,
  email           citext NOT NULL,
  phone           text,
  bank_name       text,
  bank_account_last4 text,                              -- masked by default (guide 19)
  bank_account_ref   text,                              -- encrypted at rest
  tax_id          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE owner_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  management_fee_pct    numeric(5,2) NOT NULL,           -- e.g. 25.00
  starts_on             date NOT NULL,
  renews_on             date,
  ends_on               date,
  document_id           uuid,                            -- FK added after documents
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (management_fee_pct >= 0 AND management_fee_pct <= 100)
);

-- =====================================================================
-- PROPERTIES AND UNITS
-- =====================================================================

CREATE TABLE properties (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                            -- "Vista Jaya One"
  address_line text NOT NULL,
  city         text NOT NULL,
  state         text NOT NULL,
  postcode     text,
  country_code char(2) NOT NULL DEFAULT 'MY',
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  owner_id        uuid NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  contract_id     uuid REFERENCES owner_contracts(id) ON DELETE SET NULL,
  unit_number     text NOT NULL,                         -- "#A-12-03"
  bedrooms        smallint NOT NULL DEFAULT 1,
  bathrooms       smallint NOT NULL DEFAULT 1,
  max_guests      smallint NOT NULL DEFAULT 2,
  size_sqft       integer,
  readiness       unit_readiness NOT NULL DEFAULT 'ready',
  base_rate       numeric(12,2) NOT NULL,                -- MYR nightly
  is_listed       boolean NOT NULL DEFAULT false,
  listed_at       date,
  fitted_out_at   date,                                  -- in-house furniture fit-out
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, unit_number)
);
CREATE INDEX units_owner_idx ON units(owner_id);
CREATE INDEX units_readiness_idx ON units(readiness);

CREATE TABLE unit_channels (                             -- which channels a unit is live on
  unit_id        uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  channel        booking_channel NOT NULL,
  external_ref   text,                                   -- channel listing id
  is_active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (unit_id, channel)
);

-- =====================================================================
-- GUESTS AND RESERVATIONS
-- =====================================================================

CREATE TABLE guests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL,
  email        citext,
  phone        text,
  country_code char(2),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  guest_id           uuid REFERENCES guests(id) ON DELETE SET NULL, -- null for blocks and owner stays
  channel            booking_channel NOT NULL,
  external_ref       text,                               -- channel confirmation code
  state              reservation_state NOT NULL DEFAULT 'confirmed',
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  check_in_time      time NOT NULL DEFAULT '15:00',
  check_out_time     time NOT NULL DEFAULT '11:00',
  nights             integer GENERATED ALWAYS AS (check_out - check_in) STORED,
  guests_count       smallint NOT NULL DEFAULT 1,
  gross_booking_value numeric(12,2) NOT NULL DEFAULT 0,  -- guide 12: total before deductions
  channel_fee        numeric(12,2) NOT NULL DEFAULT 0,
  collected_revenue  numeric(12,2) NOT NULL DEFAULT 0,   -- settled by channel
  currency           char(3) NOT NULL DEFAULT 'MYR',
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
CREATE INDEX reservations_unit_dates_idx ON reservations(unit_id, check_in, check_out);
CREATE INDEX reservations_state_idx ON reservations(state);

-- Prevents double-booking the same unit; excludes cancelled and no_show.
ALTER TABLE reservations ADD CONSTRAINT reservations_no_overlap
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  ) WHERE (state NOT IN ('cancelled', 'no_show', 'inquiry'));

-- =====================================================================
-- OPERATIONS — housekeeping, maintenance, inspections
-- =====================================================================

CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id           uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reservation_id    uuid REFERENCES reservations(id) ON DELETE SET NULL, -- the checkout that triggered it
  kind              task_kind NOT NULL,
  state             task_state NOT NULL DEFAULT 'open',
  title             text NOT NULL,
  instructions      text,                                -- "Linen set B. Restock coffee pods."
  assignee_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  scheduled_for     timestamptz,
  due_at            timestamptz,                         -- drives SLA remaining (guide 12)
  next_guest_at     timestamptz,                         -- check-in risk calculation
  started_at        timestamptz,
  completed_at      timestamptz,
  completed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  requires_photo    boolean NOT NULL DEFAULT true,
  sync              sync_state NOT NULL DEFAULT 'synced', -- offline field queue (guide 16.1)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_assignee_due_idx ON tasks(assignee_id, due_at);
CREATE INDEX tasks_state_due_idx ON tasks(state, due_at);

CREATE TABLE maintenance_issues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id          uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reported_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  reported_by_guest uuid REFERENCES guests(id) ON DELETE SET NULL,
  state            task_state NOT NULL DEFAULT 'open',
  title            text NOT NULL,
  detail           text,
  vendor_name      text,
  quoted_amount    numeric(12,2),
  final_amount     numeric(12,2),
  owner_approval_required boolean NOT NULL DEFAULT false,
  owner_approved_at       timestamptz,
  blocks_unit      boolean NOT NULL DEFAULT false,
  blocked_from     date,
  blocked_to       date,
  charge_to        text NOT NULL DEFAULT 'owner',        -- owner | guest_deposit | the_conts | warranty
  reported_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_unit_state_idx ON maintenance_issues(unit_id, state);

CREATE TABLE inspections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  inspector_id uuid REFERENCES users(id) ON DELETE SET NULL,
  state        task_state NOT NULL DEFAULT 'open',
  passed       boolean,
  checklist    jsonb NOT NULL DEFAULT '[]',              -- [{item, ok, note}]
  notes        text,
  inspected_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- INVENTORY AND ACCESS
-- =====================================================================

CREATE TABLE inventory_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name          text NOT NULL,                           -- "Queen bed frame + mattress"
  quantity      text NOT NULL DEFAULT '1',               -- "1 set", "3 windows"
  condition     item_condition NOT NULL DEFAULT 'good',
  supplied_in_house boolean NOT NULL DEFAULT true,       -- The Conts furniture arm
  purchase_cost numeric(12,2),
  installed_on  date,
  last_checked  date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_credentials (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind           text NOT NULL,                          -- smart_lock | key_box | guard_desk | lift_card
  label          text NOT NULL,                          -- "Smart lock, main door"
  secret         text,                                   -- ENCRYPTED. Masked by default (guide 19)
  instruction    text NOT NULL,                          -- shown to field staff and guests
  rotates_after_stay boolean NOT NULL DEFAULT false,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- FINANCE (guide 15.2 — every deduction has category, date, amount, reference)
-- =====================================================================

CREATE TABLE expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  maintenance_id uuid REFERENCES maintenance_issues(id) ON DELETE SET NULL,
  task_id        uuid REFERENCES tasks(id) ON DELETE SET NULL,
  parent_expense_id uuid REFERENCES expenses(id) ON DELETE CASCADE,  -- L2->L3 drill-down: a line item nests under its parent expense
  category       expense_category NOT NULL,
  description    text NOT NULL,
  amount         numeric(12,2) NOT NULL,
  currency       char(3) NOT NULL DEFAULT 'MYR',
  incurred_on    date NOT NULL,
  reference      text,                                   -- invoice or receipt reference
  document_id    uuid,
  charge_to      text NOT NULL DEFAULT 'owner',
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (amount >= 0)
);
CREATE INDEX expenses_unit_date_idx ON expenses(unit_id, incurred_on);
CREATE INDEX expenses_parent_idx ON expenses(parent_expense_id);

CREATE TABLE owner_statements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  state              statement_state NOT NULL DEFAULT 'provisional',
  gross_booking_value numeric(12,2) NOT NULL DEFAULT 0,
  management_fee     numeric(12,2) NOT NULL DEFAULT 0,
  expenses_total     numeric(12,2) NOT NULL DEFAULT 0,
  adjustments_total  numeric(12,2) NOT NULL DEFAULT 0,
  net_payout         numeric(12,2) NOT NULL DEFAULT 0,
  currency           char(3) NOT NULL DEFAULT 'MYR',
  generated_at       timestamptz NOT NULL DEFAULT now(),
  finalised_at       timestamptz,
  sent_at            timestamptz,
  document_id        uuid,                                -- generated PDF
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, period_start, period_end)
);

CREATE TABLE statement_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id  uuid NOT NULL REFERENCES owner_statements(id) ON DELETE CASCADE,
  unit_id       uuid REFERENCES units(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  expense_id    uuid REFERENCES expenses(id) ON DELETE SET NULL,
  line_type     text NOT NULL,                            -- gross | management_fee | expense | adjustment
  category      expense_category,
  description   text NOT NULL,
  occurred_on   date NOT NULL,
  amount        numeric(12,2) NOT NULL,                    -- negative for deductions
  reference     text,
  sort_order    smallint NOT NULL DEFAULT 0
);

CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id  uuid NOT NULL REFERENCES owner_statements(id) ON DELETE RESTRICT,
  owner_id      uuid NOT NULL REFERENCES owners(id) ON DELETE RESTRICT,
  amount        numeric(12,2) NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'MYR',
  state         payout_state NOT NULL DEFAULT 'pending',
  method        text NOT NULL DEFAULT 'bank_transfer',
  bank_last4    text,
  paid_at       timestamptz,
  failure_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- REVIEWS, PRICING, MESSAGING, AUTOMATIONS
-- =====================================================================

CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  channel        booking_channel NOT NULL,
  rating         numeric(3,2) NOT NULL,                   -- 4.92 of 5
  comment        text,
  reviewed_at    date NOT NULL,
  CHECK (rating >= 0 AND rating <= 5)
);

CREATE TABLE pricing_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid REFERENCES units(id) ON DELETE CASCADE,
  name         text NOT NULL,
  starts_on    date,
  ends_on      date,
  weekday_rate numeric(12,2),
  weekend_rate numeric(12,2),
  min_nights   smallint,
  is_active    boolean NOT NULL DEFAULT true
);

CREATE TABLE message_threads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id       uuid REFERENCES guests(id) ON DELETE SET NULL,
  owner_id       uuid REFERENCES owners(id) ON DELETE SET NULL,
  channel        booking_channel,
  subject        text,
  is_read        boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  direction   text NOT NULL,                              -- inbound | outbound
  sender_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  is_automated boolean NOT NULL DEFAULT false
);

CREATE TABLE automations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  trigger     text NOT NULL,                              -- e.g. 'reservation.confirmed'
  offset_hours integer,                                   -- -2 = two hours before
  template    text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

-- =====================================================================
-- DOCUMENTS, INTEGRATIONS, AUDIT (guide 19)
-- =====================================================================

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,                              -- statement | invoice | contract | photo | payout_advice
  file_name   text NOT NULL,
  mime_type   text NOT NULL,
  byte_size   bigint NOT NULL,
  storage_key text NOT NULL,
  unit_id     uuid REFERENCES units(id) ON DELETE CASCADE,
  owner_id    uuid REFERENCES owners(id) ON DELETE CASCADE,
  task_id     uuid REFERENCES tasks(id) ON DELETE CASCADE,
  maintenance_id uuid REFERENCES maintenance_issues(id) ON DELETE CASCADE,
  visible_to_owner boolean NOT NULL DEFAULT false,
  -- guide 7.3 photography metadata
  photographer text,
  rights_note  text,
  captured_at  timestamptz,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE owner_contracts  ADD CONSTRAINT owner_contracts_document_fk  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE owner_statements ADD CONSTRAINT owner_statements_document_fk FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE expenses         ADD CONSTRAINT expenses_document_fk         FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE integrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL,                            -- airbnb | booking_com | agoda | maybank | whatsapp
  state         integration_state NOT NULL DEFAULT 'connected',
  last_synced_at timestamptz,
  last_error    text,
  credentials   jsonb,                                    -- encrypted at rest
  UNIQUE (provider)
);

-- Actor, timestamp, before and after state, source (guide 19)
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_label  text NOT NULL,                             -- "Aina Zulkifli" — retained if user deleted
  action       text NOT NULL,                             -- 'task.assign', 'statement.send'
  entity_table text NOT NULL,
  entity_id    uuid NOT NULL,
  before_state jsonb,
  after_state  jsonb,
  source       text NOT NULL DEFAULT 'web',               -- web | field_app | owner_portal | channel_sync | system
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log(entity_table, entity_id, occurred_at DESC);

CREATE TABLE saved_views (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  screen     text NOT NULL,                               -- 'operations.today'
  name       text NOT NULL,
  filters    jsonb NOT NULL,
  is_shared  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- DERIVED METRICS (guide 12 definitions) — views, not stored duplicates
-- =====================================================================

-- Occupancy = occupied available nights / available nights
-- ADR       = accommodation revenue / occupied nights
-- RevPAR    = accommodation revenue / available nights
CREATE VIEW unit_month_performance AS
SELECT
  u.id AS unit_id,
  date_trunc('month', r.check_in)::date AS period,
  SUM(r.nights) FILTER (WHERE r.state IN ('confirmed','checked_in','checked_out')) AS occupied_nights,
  SUM(r.collected_revenue) FILTER (WHERE r.state IN ('confirmed','checked_in','checked_out')) AS accommodation_revenue,
  SUM(r.gross_booking_value) FILTER (WHERE r.state IN ('confirmed','checked_in','checked_out')) AS gross_booking_value
FROM units u
LEFT JOIN reservations r ON r.unit_id = u.id
WHERE r.channel NOT IN ('maintenance_block','owner_stay')
GROUP BY u.id, date_trunc('month', r.check_in);

-- Available nights must subtract maintenance blocks and owner stays; compute in the
-- reporting layer against a calendar table so blocked nights are excluded consistently.
