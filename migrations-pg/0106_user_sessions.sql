-- One row per signed-in browser, so Log out really ends a session. Until now the session cookie was only cleared
-- in the browser that pressed Log out; a copy of it (another tab's export, a stolen cookie) stayed valid until its
-- idle limit. Sign-in puts this row's id in the cookie; Log out deletes the row; the session middleware checks the
-- row in the query it already makes (functions/_lib/auth.ts sessionState), so it costs no extra round trip.
--
-- Optional: the code checks for this table before using it (sessionTable). Without it, sign-in issues cookies with
-- no session id and everything behaves as before. Cookies issued before this table existed carry no id, so they
-- keep working until they expire.
--
-- REVERSAL: DROP TABLE user_sessions;  (cookies with an id then fall back to the old checks)
set local search_path = pos;

CREATE TABLE user_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);

ALTER TABLE user_sessions OWNER TO pos_app;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO pos_app;
