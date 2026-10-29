-- Drop the WH and WH LT contract codes (staff, 29 Oct 2026). Showroom and warehouse is only a label on the unit; its
-- contract follows the same SOP as every unit (Package A to D from Unit资料). The sheet lists every showroom and
-- warehouse unit as LT, Package C, so the WH LT contracts become LT (long_term).
--
--   owner_contracts  contract_code 'WH LT' / revenue_model 'wh_long_term' rows become 'LT' / 'long_term'. On production
--                    these are ASTRUM-S2005, ASTRUM-S5315 and MAPLE-B1108, all with a 0% operator share, so the owner's
--                    money is the same. No contract uses 'WH'; if one does, the CHECK below fails and nothing is applied.
--                    'WH', 'WH LT' and 'wh_long_term' leave the CHECK constraints.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- Run it BEFORE deploying the code that drops wh_long_term: that code would read a leftover wh_long_term row as a guess.
--
-- BACKUP (run first): SELECT id, contract_code, revenue_model FROM owner_contracts
--                       WHERE contract_code IN ('WH', 'WH LT') OR revenue_model = 'wh_long_term';
-- REVERSAL: put back the CHECK lists of 0139, then set contract_code / revenue_model back from the backup.
set local search_path = pos;

UPDATE owner_contracts SET contract_code = 'LT', revenue_model = 'long_term'
 WHERE contract_code = 'WH LT' OR revenue_model = 'wh_long_term';

ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_revenue_model_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_revenue_model_check
  CHECK (revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term'));
ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_contract_code_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_check
  CHECK (contract_code IS NULL OR contract_code IN ('PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'));
