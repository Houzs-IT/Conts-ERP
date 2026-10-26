-- Late and short hours docked under the shift rules (HR, owner 26 Oct 2026: shift rules are a Pay rules setting, off
-- until The Conts sets its own). Kept on each payslip like every other figure, so a later rule change never rewrites a
-- slip already given out. 0 for slips made with the shift rules off.
--
-- REVERSAL: ALTER TABLE payslips DROP COLUMN late_short_hours, DROP COLUMN late_short_sen;
set local search_path = pos;

ALTER TABLE payslips ADD COLUMN IF NOT EXISTS late_short_hours NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS late_short_sen INTEGER NOT NULL DEFAULT 0;
