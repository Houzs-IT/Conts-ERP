-- Airbnb reconciliation, step 2 (chew, 11 Nov 2026; docs/superpowers/plans/2026-11-10-airbnb-reconciliation.md):
-- finance confirms each reservation, and what confirming writes is recorded so it can be undone.
--
--   airbnb_income_types      the kinds of company income, kept by finance (chew: "这个我到时要能自己维护"): types, and
--                            sub-types under a type (Additional charge: Early check-in / late checkout, Pickup, Others).
--                            system_key marks the four the rules pick by themselves: a resolution payout nothing else
--                            explains is an additional charge; an AirCover line is AirCover; money Airbnb paid back
--                            after taking it is recovered; a cancelled stay still paid is cancelled but paid. Any type
--                            can be renamed or made inactive (chew: "也可以inactive 吗？"); inactive, the rules leave
--                            the type for finance to choose. match_words: words in Airbnb's Details that pick the type.
--   airbnb_company_income    names its type and sub-type instead of step 1's fixed kinds, and the decision that wrote
--                            it (undoing the decision removes it). It had no rows: step 1 wrote nothing.
--   owner_adjustments        source 'airbnb_recon': the owner's share of a confirmed change to a month already final.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0259 (the Demo overlay
-- rebuild below is refused by the session's database tool).
set local search_path = pos;
set local lock_timeout = '5s';

-- The Demo mode overlay (migration 0203) has views over these tables; they go first and are rebuilt at the end.
select demo.drop_views();

CREATE TABLE IF NOT EXISTS airbnb_income_types (
  id           TEXT PRIMARY KEY,
  parent_id    TEXT REFERENCES airbnb_income_types(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  system_key   TEXT UNIQUE CHECK (system_key IN ('additional_charge', 'aircover', 'recovered', 'cancelled_paid')),
  match_words  TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS airbnb_income_types_parent_idx ON airbnb_income_types (parent_id);

INSERT INTO airbnb_income_types (id, parent_id, name, system_key, match_words, active, sort_order, updated_at) VALUES
  ('ait-additional',     NULL,             'Additional charge',              'additional_charge', NULL,       TRUE, 10, '2026-11-11T00:00:00Z'),
  ('ait-early-late',     'ait-additional', 'Early check-in / late checkout', NULL,                NULL,       TRUE, 11, '2026-11-11T00:00:00Z'),
  ('ait-pickup',         'ait-additional', 'Pickup',                         NULL,                NULL,       TRUE, 12, '2026-11-11T00:00:00Z'),
  ('ait-others',         'ait-additional', 'Others',                         NULL,                NULL,       TRUE, 13, '2026-11-11T00:00:00Z'),
  ('ait-compensation',   NULL,             'Compensation',                   NULL,                NULL,       TRUE, 20, '2026-11-11T00:00:00Z'),
  ('ait-aircover',       NULL,             'AirCover',                       'aircover',          'AirCover', TRUE, 30, '2026-11-11T00:00:00Z'),
  ('ait-recovered',      NULL,             'Recovered from Airbnb',          'recovered',         NULL,       TRUE, 40, '2026-11-11T00:00:00Z'),
  ('ait-cancelled-paid', NULL,             'Cancelled but paid',             'cancelled_paid',    NULL,       TRUE, 50, '2026-11-11T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Company income: its type and sub-type, and the decision that wrote it.
DROP INDEX IF EXISTS airbnb_company_income_month_idx;
ALTER TABLE airbnb_company_income DROP COLUMN IF EXISTS kind;
ALTER TABLE airbnb_company_income ADD COLUMN IF NOT EXISTS type_id TEXT REFERENCES airbnb_income_types(id);
ALTER TABLE airbnb_company_income ADD COLUMN IF NOT EXISTS sub_type_id TEXT REFERENCES airbnb_income_types(id);
ALTER TABLE airbnb_company_income ADD COLUMN IF NOT EXISTS decision_id TEXT REFERENCES airbnb_recon_decisions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS airbnb_company_income_month_type_idx ON airbnb_company_income (month, type_id);
CREATE INDEX IF NOT EXISTS airbnb_company_income_decision_idx ON airbnb_company_income (decision_id);

-- A month whose owner statement is final gets a confirmed change on next month's statement (chew, 10 Nov 2026: "下个月"):
-- an owner adjustment the reconciliation writes, marked as its own source.
ALTER TABLE owner_adjustments DROP CONSTRAINT IF EXISTS owner_adjustments_source_check;
ALTER TABLE owner_adjustments ADD CONSTRAINT owner_adjustments_source_check CHECK (source IN ('manual', 'owner_workbook', 'airbnb_recon'));

ALTER TABLE airbnb_income_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON airbnb_income_types TO pos_app;
ALTER TABLE airbnb_income_types OWNER TO pos_app;

select demo.sync();
