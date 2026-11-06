-- Contract types (PS, PS GRR, RTR, MANAGE, ...) kept by staff on Units > Unit settings instead of in code (owner, 4 Nov 2026,
-- PLAN-unit-settings.md).
--
--   contract_types       one row per type: the code staff say, its label and package, and the revenue model the owner
--                        statement works it out by. The six revenue models stay in code; a type only picks one of them.
--                        The code is the key and never changes, so label, package, order and hidden are what staff edit.
--                        The revenue model can change only while no contract uses the type.
--                        One type per model is the default (read for a contract that has no saved type).
--   owner_contracts      contract_code now points at contract_types. A hidden type stays valid on the contracts that
--                        have it. The six codes below are the old CHECK list less GRR (guaranteed rent): the owner had it
--                        removed (4 Nov 2026), and no contract on staging or production used it that day. The grr revenue
--                        model stays in code for the units with no contract whose old split still reads GRR.
--   No GRR (owner: "there is only 6 now, whatever you do don't let GRR go in"), held here as well as in the API:
--     contract_types        can never hold the code GRR or the grr model.
--     owner_contracts       no row may be written as guaranteed rent: revenue_model grr, or the old model column grr
--                           with no revenue_model (modelOf reads that as grr). NOT VALID: staging still has old rows
--                           like that (37 on 4 Nov 2026; production has none, its 25 old ones are on LT). They are
--                           left as they are, and refused if saved without being moved to one of the six.
--     units.split_kind      the old 'GRR — guaranteed rent' split stays on the units that have it (38 in production;
--                           2 of them have no contract and are still paid as GRR), but no unit is given it again.
--
-- Code that reads these checks the table exists first, so the app keeps working on a database this has not reached yet.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- BACKUP (run first, read-only): SELECT DISTINCT contract_code FROM owner_contracts;
--                       It must be a subset of PS, PS GRR, PS YGRR, LT, RTR, MANAGE (or null), else the foreign key fails.
-- REVERSAL (first re-map any contract on a type staff added: SELECT DISTINCT contract_code FROM owner_contracts
--   WHERE contract_code NOT IN ('PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'); else the CHECK below fails):
--   DROP INDEX owner_contracts_contract_code_idx;
--   ALTER TABLE owner_contracts DROP CONSTRAINT owner_contracts_contract_code_fk;
--   ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_check
--     CHECK (contract_code IS NULL OR contract_code IN ('PS', 'PS GRR', 'PS YGRR', 'LT', 'RTR', 'MANAGE', 'GRR'));
--   DROP TRIGGER units_no_new_grr ON units; DROP FUNCTION units_no_new_grr();
--   ALTER TABLE owner_contracts DROP CONSTRAINT owner_contracts_no_grr;
--   DROP TABLE contract_types;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS contract_types (
  code                 TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9 ]{1,20}$'),
  label                TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  package              TEXT CHECK (package IS NULL OR length(btrim(package)) BETWEEN 1 AND 30),
  revenue_model        TEXT NOT NULL CHECK (revenue_model IN ('management', 'management_guarantee', 'management_yearly_guarantee', 'grr', 'master_lease', 'long_term')),
  blurb                TEXT,
  is_default_for_model BOOLEAN NOT NULL DEFAULT false,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CONSTRAINT contract_types_no_grr CHECK (code <> 'GRR' AND revenue_model <> 'grr')
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_types_one_default ON contract_types (revenue_model) WHERE is_default_for_model;

INSERT INTO contract_types (code, label, package, revenue_model, blurb, is_default_for_model, sort_order, is_active, created_at, updated_at) VALUES
  ('PS', 'Airbnb profit sharing', 'Package A', 'management', 'We run it on the channels and split the profit', true, 10, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('PS GRR', 'Profit sharing with monthly GRR', 'Package B', 'management_guarantee', 'A split, with a minimum for the owner every month', true, 20, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('LT', 'Airbnb long term', 'Package C', 'long_term', 'Let to one tenant, not on the channels', true, 30, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('PS YGRR', 'Profit sharing with yearly GRR', 'Package D', 'management_yearly_guarantee', 'A split, with a minimum for the owner each contract year', true, 40, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('RTR', 'Rent to rent', NULL, 'master_lease', 'We rent the unit from the owner and run it', true, 50, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z'),
  ('MANAGE', 'Listing management', NULL, 'management', 'We manage the listing for a fee, no guarantee', false, 60, true, '2026-11-04T00:00:00Z', '2026-11-04T00:00:00Z')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_contract_code_check;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_contract_code_fk FOREIGN KEY (contract_code) REFERENCES contract_types(code) ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS owner_contracts_contract_code_idx ON owner_contracts (contract_code);

ALTER TABLE owner_contracts DROP CONSTRAINT IF EXISTS owner_contracts_no_grr;
ALTER TABLE owner_contracts ADD CONSTRAINT owner_contracts_no_grr
  CHECK (revenue_model IS DISTINCT FROM 'grr' AND (model IS DISTINCT FROM 'grr' OR revenue_model IS NOT NULL)) NOT VALID;

CREATE OR REPLACE FUNCTION units_no_new_grr() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.split_kind = 'GRR — guaranteed rent' AND (TG_OP = 'INSERT' OR OLD.split_kind IS DISTINCT FROM NEW.split_kind) THEN
    RAISE EXCEPTION 'Guaranteed rent (GRR) is no longer a contract type.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER units_no_new_grr BEFORE INSERT OR UPDATE OF split_kind ON units FOR EACH ROW EXECUTE FUNCTION units_no_new_grr();
