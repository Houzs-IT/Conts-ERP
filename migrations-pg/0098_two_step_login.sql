-- Two-step sign-in (an authenticator-app code after the password) and a record of every sign-in attempt.
--
--   users.totp_secret      the authenticator secret, encrypted (AES-GCM) with the TOTP_ENC_KEY server secret;
--                          never stored in plain text. Set while someone is setting it up, kept once confirmed.
--   users.totp_enabled_at  when they confirmed it with a code; NULL means two-step sign-in is off for them.
--   users.totp_last_step   the 30-second step of the last code accepted, so the same code cannot be used twice.
--   user_backup_codes      ten single-use codes shown once at setup, stored as hashes only.
--   login_events           every sign-in attempt: who, when, from where, and how it ended. Written by
--                          functions/api/auth/login*.ts; shown on Users and roles > Sign-ins and My account.
--
-- Depends on 0055 (users.sessions_revoked_at) only in that both are read by the session middleware, which
-- checks for each column before using it, so either can reach a database first.
--
-- REVERSAL:
--   DROP TABLE login_events; DROP TABLE user_backup_codes;
--   ALTER TABLE users DROP COLUMN totp_secret, DROP COLUMN totp_enabled_at, DROP COLUMN totp_last_step;
set local search_path = pos;

ALTER TABLE users ADD COLUMN totp_secret     TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
ALTER TABLE users ADD COLUMN totp_last_step  BIGINT;

CREATE TABLE user_backup_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX user_backup_codes_user_idx ON user_backup_codes(user_id);

CREATE TABLE login_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  at         TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  result     TEXT NOT NULL CHECK (result IN ('success','wrong_password','locked','2fa_failed','inactive')),
  method     TEXT NOT NULL CHECK (method IN ('password','totp','backup_code','reset_link'))
);
CREATE INDEX login_events_at_idx ON login_events(at DESC);
CREATE INDEX login_events_user_at_idx ON login_events(user_id, at DESC);

ALTER TABLE user_backup_codes OWNER TO pos_app;
ALTER TABLE user_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events OWNER TO pos_app;
ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_backup_codes, login_events TO pos_app;
