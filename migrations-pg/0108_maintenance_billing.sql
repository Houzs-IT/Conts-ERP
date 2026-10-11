-- A repair job's money after the quote (owner, 11 Oct 2026). The quote is often billed on a later date than the
-- repair, and the office needs to see whether the payer's money came in and whether the technician or contractor
-- has been paid. Optional: the code reads and writes these columns only when they exist; without them the job
-- behaves as before (the expense is dated the day the job is marked done, and nothing is tracked after that).
--
--   maintenance_issues.billing_date        YYYY-MM-DD the repair is billed on; the unit's maintenance expense is dated
--                                          this day, so it lands in that month's costs and owner statement
--   maintenance_issues.collected_at        YYYY-MM-DD the payer's money (owner, guest deposit) was received; empty = not yet
--   maintenance_issues.contractor_amount   sen owed to the technician or contractor for the job (what accounts pay out)
--   maintenance_issues.contractor_paid_at  YYYY-MM-DD accounts paid the technician or contractor; empty = not yet
--
-- REVERSAL: ALTER TABLE maintenance_issues DROP COLUMN billing_date, DROP COLUMN collected_at,
--           DROP COLUMN contractor_amount, DROP COLUMN contractor_paid_at;
set local search_path = pos;

ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS billing_date TEXT;
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS collected_at TEXT;
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS contractor_amount INTEGER CHECK (contractor_amount IS NULL OR contractor_amount >= 0);
ALTER TABLE maintenance_issues ADD COLUMN IF NOT EXISTS contractor_paid_at TEXT;
