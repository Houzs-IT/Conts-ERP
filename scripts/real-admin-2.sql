-- Second real management (top-level) account, admin@theconts.com. Temporary
-- password; forced to set a real one on first login (must_change_password = 1).
INSERT INTO users (id, email, full_name, phone, password_hash, role, must_change_password, is_active, created_at, updated_at)
VALUES ('user-admin-002', 'admin@theconts.com', 'Administrator', NULL, 'pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT', 'management', 1, 1, datetime('now'), datetime('now'));
