-- users.sessions_revoked_at: management's "Sign out everywhere" (functions/api/users/[id]/security.ts) and a
-- completed password reset stamp it; the session middleware refuses any cookie signed in before it. Sessions are
-- signed cookies with no server-side list, so this one timestamp is what ends them all at once.
--
-- REVERSAL: ALTER TABLE users DROP COLUMN sessions_revoked_at;
set local search_path = pos;

ALTER TABLE users ADD COLUMN sessions_revoked_at TEXT;
