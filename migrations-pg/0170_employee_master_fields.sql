-- Employee Master as Hookka's employee form (owner, 26 Oct 2026): position, leader allowance and efficiency allowance on
-- the employee record, and the month's allowance on each payslip.
--
--   employees.position                   free text (Cleaner, Cleaning leader, ...), as on Hookka.
--   employees.leader_allowance_sen       a flat monthly amount, less the share of working days missed (Hookka's
--                                        resolveLeadershipAllowanceSen). Added to gross only: EPF, SOCSO, EIS and PCB
--                                        are worked out without it, as on Hookka.
--   employees.efficiency_allowance_sen   paid on Hookka when the month's efficiency reaches the threshold. Kept, not
--   employees.efficiency_threshold_pct   paid: The Conts has not decided what production time is, so there is no
--                                        efficiency to test.
--   payslips.allowance_sen               the month's allowances.
-- employees.ic_number and passport_number stay but are no longer asked for (owner, 26 Oct 2026).
--
-- REVERSAL: ALTER TABLE payslips DROP COLUMN allowance_sen;
--           ALTER TABLE employees DROP COLUMN position, DROP COLUMN leader_allowance_sen,
--             DROP COLUMN efficiency_allowance_sen, DROP COLUMN efficiency_threshold_pct;
set local search_path = pos;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leader_allowance_sen INTEGER NOT NULL DEFAULT 0 CHECK (leader_allowance_sen >= 0);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS efficiency_allowance_sen INTEGER NOT NULL DEFAULT 0 CHECK (efficiency_allowance_sen >= 0);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS efficiency_threshold_pct NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (efficiency_threshold_pct BETWEEN 0 AND 200);
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS allowance_sen INTEGER NOT NULL DEFAULT 0;
