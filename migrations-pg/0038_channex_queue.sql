-- Channex certification: changes to availability, prices and restrictions are no longer sent from the
-- save handler. They go into channex_outbox and a sender batches everything waiting into one
-- /availability call and one /restrictions call, within Channex's 20 ARI calls per minute, retrying
-- 429/5xx with backoff. channex_calls logs every call (and Channex's task id) for the rate budget and
-- as the evidence the certification form asks for. unit_restrictions holds the minimum stay and stop
-- sell a unit carries per night, set on the Calendar.
-- REVERSAL: DROP TABLE channex_calls; DROP TABLE channex_outbox; DROP TABLE unit_restrictions;
set local search_path = pos;

CREATE TABLE unit_restrictions (
  unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  rate_date  TEXT NOT NULL,
  min_stay   INTEGER CHECK (min_stay IS NULL OR min_stay BETWEEN 1 AND 60),
  stop_sell  BOOLEAN NOT NULL DEFAULT false,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (unit_id, rate_date)
);

CREATE TABLE channex_outbox (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('availability','restrictions')),
  unit_id         TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  property_id     TEXT NOT NULL,
  room_type_id    TEXT,
  rate_plan_id    TEXT,
  date_from       TEXT NOT NULL,
  date_to         TEXT NOT NULL,            -- inclusive, as Channex takes it
  availability    INTEGER,                  -- kind = availability
  rate            NUMERIC(12,2),            -- kind = restrictions; each of these three is sent only when set
  min_stay        INTEGER,
  stop_sell       BOOLEAN,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_status     INTEGER,
  last_error      TEXT,
  task_id         TEXT,
  created_at      TEXT NOT NULL,
  sent_at         TEXT
);
CREATE INDEX idx_chx_outbox_due ON channex_outbox (status, next_attempt_at);
CREATE INDEX idx_chx_outbox_unit ON channex_outbox (unit_id);

CREATE TABLE channex_calls (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,                  -- availability | restrictions
  called_at TEXT NOT NULL,
  status    INTEGER NOT NULL,               -- HTTP status, 0 for a network error
  task_id   TEXT,
  row_count INTEGER NOT NULL,
  full_sync BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX idx_chx_calls_at ON channex_calls (called_at);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
