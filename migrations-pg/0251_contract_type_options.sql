-- A contract type is an income model plus the options ticked on Units > Unit settings (PLAN-contract-type-options.md).
-- Until now the extra terms were tied to three codes in the program: MANAGE (owner paid a fixed amount), RTR (the
-- rent-out grid) and LT (no operator share). They become columns, so staff can open a type like them without a developer.
--
--   has_fixed_owner_amount   profit share only: an Owner (RM) box instead of Owner %.
--   has_agent_share          profit share only: the Agent % and Agent name boxes.
--   has_no_operator_share    long-term let only: the operator share is 0.
--   has_rent_out_grid        master lease only: both sides of a rent to rent, with deposits.
--
-- The backfill keeps every type as it behaves today: every profit share type had the agent boxes, every long-term type
-- was saved with no operator share, and only MANAGE and RTR had their own terms.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- BACKUP (run first, read-only): SELECT code, revenue_model FROM contract_types;
-- REVERSAL (the app then reads the options from the code again, as before):
--   ALTER TABLE contract_types DROP CONSTRAINT contract_types_options_fit_model,
--     DROP COLUMN has_fixed_owner_amount, DROP COLUMN has_agent_share, DROP COLUMN has_no_operator_share, DROP COLUMN has_rent_out_grid;
set local search_path = pos;

ALTER TABLE contract_types
  ADD COLUMN IF NOT EXISTS has_fixed_owner_amount BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_agent_share        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_no_operator_share  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_rent_out_grid      BOOLEAN NOT NULL DEFAULT false;

UPDATE contract_types SET has_agent_share = true
  WHERE revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee');
UPDATE contract_types SET has_fixed_owner_amount = true
  WHERE code = 'MANAGE' AND revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee');
UPDATE contract_types SET has_no_operator_share = true WHERE revenue_model = 'long_term';
UPDATE contract_types SET has_rent_out_grid = true WHERE code = 'RTR' AND revenue_model = 'master_lease';

ALTER TABLE contract_types DROP CONSTRAINT IF EXISTS contract_types_options_fit_model;
ALTER TABLE contract_types ADD CONSTRAINT contract_types_options_fit_model CHECK (
  (NOT (has_fixed_owner_amount OR has_agent_share) OR revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee'))
  AND (NOT has_no_operator_share OR revenue_model = 'long_term')
  AND (NOT has_rent_out_grid OR revenue_model = 'master_lease'));
