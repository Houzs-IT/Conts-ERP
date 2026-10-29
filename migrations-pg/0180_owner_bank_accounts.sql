-- Several bank accounts per owner (staff, 29 Oct 2026). Some owners have one account per building or unit. The owner's
-- own bank columns stay as the main account; this adds the extra ones, and each unit may point at one of them.
-- A unit that points at none is paid to the owner's main account, so nothing changes for owners with one account.
--
--   owner_bank_accounts       an extra account of an owner: label (e.g. the building), bank, full number, holder, last four
--   units.bank_account_id     the extra account this unit's profit is paid to (null: the owner's main account)
--
-- Additive only. The code reads these only when they exist, so a deploy before this runs changes nothing.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
--
-- REVERSAL: ALTER TABLE units DROP COLUMN bank_account_chosen, DROP COLUMN bank_account_id; DROP TABLE owner_bank_accounts;
set local search_path = pos;

CREATE TABLE IF NOT EXISTS owner_bank_accounts (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  label           TEXT,
  bank_name       TEXT,
  account_number  TEXT NOT NULL,
  account_holder  TEXT,
  account_last4   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS owner_bank_accounts_owner_idx ON owner_bank_accounts(owner_id);

ALTER TABLE units ADD COLUMN IF NOT EXISTS bank_account_id TEXT REFERENCES owner_bank_accounts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS units_bank_account_idx ON units(bank_account_id) WHERE bank_account_id IS NOT NULL;
-- A person chose this unit's account on the unit page (including "the owner's main account"): the import leaves it alone.
ALTER TABLE units ADD COLUMN IF NOT EXISTS bank_account_chosen BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE owner_bank_accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON owner_bank_accounts TO pos_app;
ALTER TABLE owner_bank_accounts OWNER TO pos_app;
