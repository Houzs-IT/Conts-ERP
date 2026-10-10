-- Owner statements built the way the owner workbook builds them (functions/_lib/ownerStatement.ts), and the
-- Owner Income Report printed from them. Every change is additive.
--
--   statement_units        one row per unit on a statement: the month's nights, gross income, deductions, the
--                          split, the guarantee top-up, owner adjustments and the payout. Frozen with the
--                          statement, so the report and the year-to-date page read exactly what was paid.
--   statement_lines.quantity   nights on an income line, sessions on a cleaning line, months on a bill
--   statement_lines.adjustment_id   the owner adjustment (O2 credit or charge) a line came from
--   units.misc_charges     the workbook's "Miscellaneous Charges" flag for a unit that has no contract record
--                          (Unit资料 rows without a contract start date); a contract's own flag wins when there is one
--   settings               report header and terms (report.*), and the company letterhead the owner uses on the
--                          report (company.*), only where nobody has set them yet
--
-- REVERSAL:
--   DROP TABLE statement_units; ALTER TABLE statement_lines DROP COLUMN quantity, DROP COLUMN adjustment_id; ALTER TABLE units DROP COLUMN misc_charges;
--   DELETE FROM settings WHERE key LIKE 'report.%';
set local search_path = pos;

CREATE TABLE statement_units (
  id                TEXT PRIMARY KEY,
  statement_id      TEXT NOT NULL REFERENCES owner_statements(id) ON DELETE CASCADE,
  unit_id           TEXT NOT NULL REFERENCES units(id),
  -- 'share': the owner gets a percentage of the net income (profit share or management fee);
  -- 'fixed_rent': the owner gets a fixed monthly rent (long term / GRR), whatever the unit earned.
  basis             TEXT NOT NULL CHECK (basis IN ('share','fixed_rent')),
  -- Where the split came from: the unit's contract, the unit's own split, or the organisation default.
  terms_source      TEXT NOT NULL CHECK (terms_source IN ('contract','unit','default')),
  nights            INTEGER NOT NULL DEFAULT 0,
  days              INTEGER NOT NULL,
  gross_income      INTEGER NOT NULL DEFAULT 0,  -- sen
  deductions        INTEGER NOT NULL DEFAULT 0,
  net_income        INTEGER NOT NULL DEFAULT 0,
  owner_pct         DOUBLE PRECISION,
  operator_share    INTEGER NOT NULL DEFAULT 0,
  guarantee         INTEGER NOT NULL DEFAULT 0,
  top_up            INTEGER NOT NULL DEFAULT 0,
  fixed_rent        INTEGER NOT NULL DEFAULT 0,
  payout_before_adjustments INTEGER NOT NULL DEFAULT 0,
  adjustments_total INTEGER NOT NULL DEFAULT 0,
  net_payout        INTEGER NOT NULL DEFAULT 0,
  -- What finance should check before finalising (JSON array of sentences), e.g. a stay with no payout recorded.
  notes             TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (statement_id, unit_id)
);
CREATE INDEX statement_units_unit_idx ON statement_units(unit_id);

ALTER TABLE statement_lines ADD COLUMN quantity DOUBLE PRECISION;
ALTER TABLE statement_lines ADD COLUMN adjustment_id TEXT REFERENCES owner_adjustments(id) ON DELETE SET NULL;
ALTER TABLE units ADD COLUMN misc_charges INTEGER NOT NULL DEFAULT 0;

-- The letterhead on the owner's own report (E-28-02 & E-28-03, Menara Suezcap 2). Written only where the
-- setting was never saved or still holds the value the first migration put there.
-- (The settings screen reads company.* first and the older org.* keys after, so a company.* row wins.)
INSERT INTO settings (key, value, updated_at)
SELECT x.key, x.value, '2026-10-08T00:00:00Z'
FROM (VALUES
  ('company.legalName', 'The Conts Sdn. Bhd.', 'org.legal_name', 'The Conts Sdn Bhd'),
  ('company.address', 'E-28-02 & E-28-03, Menara Suezcap 2, KL Gateway, No. 2, Jalan Kerinchi, Gerbang Kerinchi Lestari, 59200 Kuala Lumpur, W.P. Kuala Lumpur.', 'org.address', 'C-41-06, Jaya One, Jalan Universiti, 46200 Petaling Jaya'),
  ('company.supportPhone', '011-6133 3289', 'org.support_phone', '+60 17-465 8868'),
  ('company.supportEmail', 't.conts725@gmail.com', NULL, NULL)
) AS x(key, value, legacy, seeded)
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = x.key)
  AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = x.legacy AND s.value <> x.seeded);

-- Report wording. One term per line; the report numbers them.
INSERT INTO settings (key, value, updated_at) VALUES
  ('report.paymentTerms', '7th every month', '2026-10-08T00:00:00Z'),
  ('report.monthlyTerms', 'Rental/booking revenue is based on actual confirmed stays during the billing month.
Cleaning, utilities, maintenance, and other expenses are deducted as per agreed service terms.
Owner payouts will be processed and transferred by the 7 working day of the following month, unless delayed by force majeure or third-party platform settlement.
Any discrepancies or disputes regarding the report must be raised in writing within 7 days of receiving the statement. After this period, the report is deemed accepted.
This report is confidential and is intended solely for the property owner. It may not be shared or disclosed to third parties without written consent from The Conts Sdn Bhd.', '2026-10-08T00:00:00Z'),
  ('report.yearTerms', 'All monthly payouts have been made based on verified reports. This annual summary is for owner reference and may be used for internal financial review or tax preparation.
Any income or cost adjustment (e.g., guest refunds, penalty charges, or ad-hoc maintenance) will be reflected in the monthly reports and carried forward into the annual summary accordingly.
This report is confidential and is intended solely for the property owner. It may not be shared or disclosed to third parties without written consent from The Conts Sdn Bhd.', '2026-10-08T00:00:00Z'),
  -- What a unit with miscellaneous charges pays for a fully booked month, sen; the workbook scales it by occupancy.
  ('report.miscChargeMonthly', '10000', '2026-10-08T00:00:00Z')
ON CONFLICT (key) DO NOTHING;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
