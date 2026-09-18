-- Removes everything scripts/test-owner-verify.sql created. Run after you're
-- done confirming the pipeline works, before onboarding real owners.
DELETE FROM units WHERE id = 'test-unit-001';
DELETE FROM owner_contracts WHERE id = 'test-contract-001';
DELETE FROM owners WHERE id = 'test-owner-001';
DELETE FROM users WHERE id = 'test-user-001';
DELETE FROM properties WHERE id = 'test-prop-001';
