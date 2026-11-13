-- Airbnb reconciliation (chew, 10 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md). Finance
-- uploads Airbnb's transaction CSVs for a month; each booking's payments are matched to the booking by its
-- confirmation code and the differences are sorted by rule. Nothing changes until finance confirms a booking.
--
--   airbnb_recon_files       one row per uploaded file: the month on screen when it was uploaded, its lines, how many
--                            were new and how many were already there.
--   airbnb_transactions      one row per CSV line, never twice: dedupe_key is Date + Type + Confirmation code +
--                            Amount + Paid out + Reference code (chew: "duplicate 的不要录到两次"; a second identical
--                            line in one file gets "#2"). month is the line's own Date. Amounts in sen.
--   airbnb_recon_decisions   what finance confirmed for a booking in a month: the rule, the action, a note, who, when.
--   airbnb_company_income    money that is the company's, never an owner's, kept apart by kind (chew: "要分开记"):
--                            extra charges (e.g. airport pickup), money won back from Airbnb, cancelled but paid,
--                            AirCover reimbursement.
--
-- Access: a new area, airbnbRecon, closed for every department until management grants it (chew: "到时我才给权限").
-- Management always has it.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0258 (the Demo overlay
-- rebuild below is refused by the session's database tool). The code checks the tables exist.
-- REVERSAL: nothing else reads these tables; leave them empty, or remove them together with a redeploy.
set local search_path = pos;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS airbnb_recon_files (
  id           TEXT PRIMARY KEY,
  month        TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  file_name    TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  added        INTEGER NOT NULL DEFAULT 0,
  duplicates   INTEGER NOT NULL DEFAULT 0,
  uploaded_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airbnb_recon_files_month_idx ON airbnb_recon_files (month);

CREATE TABLE IF NOT EXISTS airbnb_transactions (
  id              TEXT PRIMARY KEY,
  file_id         TEXT NOT NULL REFERENCES airbnb_recon_files(id) ON DELETE CASCADE,
  month           TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  dedupe_key      TEXT NOT NULL UNIQUE,
  txn_date        TEXT NOT NULL CHECK (txn_date ~ '^\d{4}-\d{2}-\d{2}$'),
  arriving_by     TEXT,
  type            TEXT NOT NULL,
  code            TEXT,
  booking_date    TEXT,
  start_date      TEXT,
  end_date        TEXT,
  nights          INTEGER,
  guest           TEXT,
  listing         TEXT,
  details         TEXT,
  reference_code  TEXT,
  currency        TEXT,
  amount          INTEGER NOT NULL DEFAULT 0,
  paid_out        INTEGER NOT NULL DEFAULT 0,
  service_fee     INTEGER,
  fast_pay_fee    INTEGER,
  cleaning_fee    INTEGER,
  gross_earnings  INTEGER,
  remitted_tax    INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airbnb_transactions_month_code_idx ON airbnb_transactions (month, code);
CREATE INDEX IF NOT EXISTS airbnb_transactions_code_idx ON airbnb_transactions (code);

CREATE TABLE IF NOT EXISTS airbnb_recon_decisions (
  id            TEXT PRIMARY KEY,
  month         TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  code          TEXT NOT NULL,
  rule          TEXT NOT NULL,
  action        TEXT NOT NULL,
  note          TEXT,
  applied       TEXT,
  confirmed_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at  TEXT NOT NULL,
  UNIQUE (month, code)
);

CREATE TABLE IF NOT EXISTS airbnb_company_income (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('extra_charge', 'won_back', 'cancelled_paid', 'aircover')),
  month            TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  code             TEXT,
  reservation_id   TEXT,
  unit_id          TEXT,
  amount           INTEGER NOT NULL,
  occurred_on      TEXT NOT NULL CHECK (occurred_on ~ '^\d{4}-\d{2}-\d{2}$'),
  transaction_ids  TEXT,
  note             TEXT,
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airbnb_company_income_month_idx ON airbnb_company_income (month, kind);

ALTER TABLE airbnb_recon_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE airbnb_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE airbnb_recon_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE airbnb_company_income ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON airbnb_recon_files, airbnb_transactions, airbnb_recon_decisions, airbnb_company_income TO pos_app;
ALTER TABLE airbnb_recon_files OWNER TO pos_app;
ALTER TABLE airbnb_transactions OWNER TO pos_app;
ALTER TABLE airbnb_recon_decisions OWNER TO pos_app;
ALTER TABLE airbnb_company_income OWNER TO pos_app;

-- Closed for every department until management opens it; a department's own rule wins over its Finance baseline.
INSERT INTO access_rules (scope, scope_id, area, level, updated_by)
SELECT 'department', d.id, 'airbnbRecon', 'none', 'migration 0258' FROM departments d
ON CONFLICT (scope, scope_id, area) DO NOTHING;

-- Rebuild the Demo mode overlay (migration 0203) so demo_pos has the new tables too.
select demo.drop_views();
select demo.sync();
