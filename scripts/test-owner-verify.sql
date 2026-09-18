-- PRE-LAUNCH VERIFICATION ONLY. Clearly fake so it's easy to find and remove
-- before real launch. Delete with scripts/delete-test-owner.sql when done.
INSERT INTO properties (id, name, address_line, city, state, postcode, country_code, created_at, updated_at)
VALUES ('test-prop-001', 'TEST PROPERTY - delete before launch', 'N/A', 'N/A', 'N/A', NULL, 'MY', datetime('now'), datetime('now'));

INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, is_active, created_at, updated_at)
VALUES ('test-user-001', 'test-owner@example.com', 'TEST OWNER - delete before launch', NULL, 'pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT', 'owner', 0, 1, datetime('now'), datetime('now'));

INSERT INTO owners (id, user_id, display_name, email, phone, bank_name, bank_account_last4, created_at, updated_at)
VALUES ('test-owner-001', 'test-user-001', 'TEST OWNER - delete before launch', 'test-owner@example.com', NULL, 'TEST BANK', '0000', datetime('now'), datetime('now'));

INSERT INTO owner_contracts (id, owner_id, management_fee_pct, starts_on, created_at)
VALUES ('test-contract-001', 'test-owner-001', 25, date('now'), datetime('now'));

INSERT INTO units (id, property_id, owner_id, contract_id, unit_number, bedrooms, bathrooms, max_guests, base_rate, is_listed, created_at, updated_at)
VALUES ('test-unit-001', 'test-prop-001', 'test-owner-001', 'test-contract-001', 'TEST-001', 1, 1, 2, 10000, 1, datetime('now'), datetime('now'));
