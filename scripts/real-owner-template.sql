-- Adds ONE real property, one real owner, their login, a management contract,
-- and one unit. Copy this file (e.g. to real-owner-1.sql), replace every
-- REPLACE: value below, then run it against the REAL production database:
--
--   npx wrangler d1 execute theconts-prod --remote --file=./real-owner-1.sql
--
-- Before running: generate the owner's temporary password hash with:
--   node scripts/hash-password.mjs "SomeTemporaryPassword1"
-- and paste the output where it says REPLACE: paste hash here.
-- Money (base_rate) is in sen: RM 250/night = 25000.
-- The ids below (prop-001 etc.) just need to be unique text — change them if
-- you add a second owner later (prop-002, owner-002, and so on).

INSERT INTO properties (id, name, address_line, city, state, postcode, country_code, created_at, updated_at)
VALUES ('prop-001', 'REPLACE: Building name', 'REPLACE: Address line', 'REPLACE: City', 'REPLACE: State', 'REPLACE: Postcode', 'MY', datetime('now'), datetime('now'));

INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, is_active, created_at, updated_at)
VALUES ('user-owner-001', 'REPLACE: owner@email.com', 'REPLACE: Owner full name', 'REPLACE: +60...', 'REPLACE: paste hash here', 'owner', 1, 1, datetime('now'), datetime('now'));

INSERT INTO owners (id, user_id, display_name, email, phone, bank_name, bank_account_last4, created_at, updated_at)
VALUES ('owner-001', 'user-owner-001', 'REPLACE: Owner full name', 'REPLACE: owner@email.com', 'REPLACE: +60...', 'REPLACE: Bank name', 'REPLACE: last 4 digits', datetime('now'), datetime('now'));

INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, created_at)
VALUES ('contract-001', 'owner-001', 25, date('now'), datetime('now'));

INSERT INTO units (id, property_id, owner_id, contract_id, unit_number, bedrooms, bathrooms, max_guests, base_rate, is_listed, created_at, updated_at)
VALUES ('unit-001', 'prop-001', 'owner-001', 'contract-001', 'REPLACE: e.g. #A-12-03', 2, 2, 4, 25000, 1, datetime('now'), datetime('now'));
