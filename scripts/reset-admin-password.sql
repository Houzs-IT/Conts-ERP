UPDATE users SET password_hash = 'pbkdf2$ALREADY-APPLIED-HASH-REDACTED-BEFORE-COMMIT', failed_attempts = 0, locked_until = NULL, updated_at = datetime('now')
WHERE id = 'user-admin-001';
