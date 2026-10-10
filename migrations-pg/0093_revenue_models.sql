-- One revenue model per contract, contract history per unit, and who pays an expense. Every change is additive:
-- no column is dropped, no value that was allowed before is refused.
--
--   owner_contracts.revenue_model   how the owner is paid, one of five:
--        management            profit share / management fee: income less owner-paid costs, split by owner %
--        management_guarantee  the same with a monthly minimum the owner always gets (Package D)
--        grr                   guaranteed rent: a fixed monthly rent to the owner; income and costs are the company's
--        master_lease          the company rents the unit from the owner: no owner statement, the rent is a company cost
--        long_term             let to a long-term tenant (not on the calendar or channels): the owner gets the rent less
--                              the management fee and owner-paid costs
--   owner_contracts.unit_id         the unit the contract is for, so a unit can keep its earlier contracts (history);
--                                   units.contract_id stays the one in force
--   owner_contracts.agent_name      who brought the unit in (agent_fee_pct already holds their share)
--   owner_contracts.deposit_amount  master lease: the deposit paid to the owner (sen)
--   owner_contracts.tenant_name     long term: the tenant
--        grr_amount stays the monthly rent for grr, master_lease and long_term (sen).
--   expenses.receipt_document_id    the receipt photo or PDF (documents, kind 'receipt')
--   expenses.category               also 'sewerage' (Indah Water); before, Indah Water was 'utilities' with "Indah" in
--                                   the description, which the statement still reads the same way
--   statement_units.revenue_model   the model a statement was worked out on, so the report labels it after the
--                                   contract changes
--
-- Who pays an expense ("Paid by" on screen) is expenses.charge_to, which has existed since 0001 and is what the
-- statement already filters on (only 'owner' is deducted). No second payer column is added: the values are
-- owner (Owner, via statement), the_conts (Company), tenant (Tenant), guest_deposit (Guest), warranty (Warranty).
--
-- Backfill (revenue_model), in this order, matching what the statement engine already does with each contract so
-- every existing statement figure stays the same:
--   model = 'grr'                                         -> grr
--   minimum_guarantee > 0, or the unit is on 'Package D'  -> management_guarantee
--   anything else (profit share / management fee)         -> management
-- units.term is not used: every unit defaults to 'Long term', so it does not tell a long-term let apart.
-- master_lease and long_term are new; no existing contract is put on them.
-- revenue_model stays nullable: a contract written by something that does not know the column (the HostPlatform /
-- owner workbook import, POST /api/contracts) reads by the same rule (functions/_lib/revenueModel.ts, modelOf).
-- unit_id: set where exactly one unit points at the contract.
--
-- REVERSAL:
--   ALTER TABLE owner_contracts DROP COLUMN revenue_model, DROP COLUMN unit_id, DROP COLUMN agent_name,
--     DROP COLUMN deposit_amount, DROP COLUMN tenant_name;
--   ALTER TABLE expenses DROP COLUMN receipt_document_id;
--   UPDATE expenses SET category = 'utilities', description = 'Indah Water ' || description WHERE category = 'sewerage';
--   ALTER TABLE expenses DROP CONSTRAINT expenses_category_check; ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
--     ('internet','electricity','water','cleaning','housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other'));
--   ALTER TABLE statement_units DROP COLUMN revenue_model;
set local search_path = pos;

ALTER TABLE owner_contracts ADD COLUMN revenue_model TEXT
  CHECK (revenue_model IN ('management','management_guarantee','grr','master_lease','long_term'));
ALTER TABLE owner_contracts ADD COLUMN unit_id        TEXT REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE owner_contracts ADD COLUMN agent_name     TEXT;
ALTER TABLE owner_contracts ADD COLUMN deposit_amount INTEGER CHECK (deposit_amount IS NULL OR deposit_amount >= 0);
ALTER TABLE owner_contracts ADD COLUMN tenant_name    TEXT;

UPDATE owner_contracts c SET revenue_model = CASE
  WHEN c.model = 'grr' THEN 'grr'
  WHEN c.minimum_guarantee > 0 OR EXISTS (SELECT 1 FROM units u WHERE u.contract_id = c.id AND u.package = 'Package D') THEN 'management_guarantee'
  ELSE 'management' END;

UPDATE owner_contracts c SET unit_id = x.unit_id
FROM (SELECT contract_id, MIN(id) AS unit_id FROM units WHERE contract_id IS NOT NULL GROUP BY contract_id HAVING COUNT(*) = 1) x
WHERE x.contract_id = c.id;
CREATE INDEX owner_contracts_unit_idx ON owner_contracts(unit_id);

ALTER TABLE expenses ADD COLUMN receipt_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_category_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_category_check CHECK (category IN
  ('internet','electricity','water','sewerage','cleaning','housekeeping','maintenance','utilities','consumables','furniture','management_fee','channel_fee','other'));

ALTER TABLE statement_units ADD COLUMN revenue_model TEXT;
