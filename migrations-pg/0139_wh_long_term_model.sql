-- A seventh income model (owner, 22 Oct 2026): a showroom or warehouse let long term to one of our own businesses
-- (Dream Crafter, Inhouse Reno) or another tenant.
--
--   owner_contracts.revenue_model   gains wh_long_term: worked out like long_term (the owner gets the tenant's monthly
--                                   rent less the operator % and owner-paid costs, on a normal owner statement), but only
--                                   on a showroom or warehouse unit, and named apart in every list and report.
--   owner_contracts.contract_code   gains 'WH LT', the staff's code for it (functions/_lib/unitPurpose.ts).
--
-- No existing contract is moved onto it.
--
-- REVERSAL (only once no contract uses it):
--   ALTER TABLE owner_contracts DROP CONSTRAINT owner_contracts_revenue_model_check;
--   ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_revenue_model_check
--     CHECK (revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term'));
--   ALTER TABLE owner_contracts DROP CONSTRAINT owner_contracts_contract_code_check;
--   ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_check
--     CHECK (contract_code IS NULL OR contract_code IN ('WH', 'PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'));
set local search_path = pos;

ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_revenue_model_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_revenue_model_check
  CHECK (revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term', 'wh_long_term'));
ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_contract_code_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_check
  CHECK (contract_code IS NULL OR contract_code IN ('WH', 'WH LT', 'PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'));
