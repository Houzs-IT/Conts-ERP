-- 0378_mcp_connector: the AI Connector (a remote MCP server), owner 25 Nov 2026: every company system gets the AI
-- Connector that Hookka and Houzs already have. Staff connect Claude or ChatGPT to the ERP with THEIR OWN login,
-- READ-ONLY, seeing only what that login sees; management approves each person, sees every lookup and can disconnect
-- anyone (functions/_lib/mcpServer.ts, mcpStore.ts, functions/api/mcp, functions/api/ai-connector).
-- The owner approved adding these tables (25 Nov 2026). Additive only: seven new tables, no existing table or row changes.
--
--   mcp_access           who may connect (approved by management; management itself always may).
--   mcp_access_requests  "Request access" from the AI Connector page; Approve / Reject.
--   mcp_oauth_clients    OAuth dynamic client registration: one row per AI app that registered.
--   mcp_auth_requests    a pending "Allow?" screen (10 minutes), between the AI app's authorize redirect and the click.
--   mcp_oauth_codes      one-time authorization codes (PKCE S256), 10 minutes, SHA-256 hash only.
--   mcp_tokens           access (24 h) and refresh (90 days, rotating) tokens, SHA-256 hashes only.
--   mcp_calls            one row per AI lookup: who, which app, what, the result.
--
-- Until this is applied the code answers "not set up yet" on every connector endpoint (mcpReady); nothing else reads
-- these tables. Timestamps are ISO text, as in users, audit_log and user_notifications.
--
-- REVERSAL (revert the code first; it reads every table):
--   drop table if exists pos.mcp_calls, pos.mcp_tokens, pos.mcp_oauth_codes, pos.mcp_auth_requests,
--     pos.mcp_oauth_clients, pos.mcp_access_requests, pos.mcp_access;
--   select demo.sync();
-- GRANTS: pos_app owns the tables (as 0349 user_roles), so nothing to re-apply.

set local search_path = pos;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mcp_access (
  user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  approved_by TEXT,
  approved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_access_requests (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT,
  status     TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS mcp_access_requests_status_idx ON mcp_access_requests (status, created_at);
CREATE INDEX IF NOT EXISTS mcp_access_requests_user_idx ON mcp_access_requests (user_id);

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_auth_requests (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  state          TEXT,
  code_challenge TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_auth_requests_expires_idx ON mcp_auth_requests (expires_at);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  used           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expires_idx ON mcp_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id          TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  access_hash        TEXT NOT NULL,
  access_expires_at  TEXT NOT NULL,
  refresh_hash       TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  last_used_at       TEXT,
  revoked_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_access_idx ON mcp_tokens (access_hash);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_refresh_idx ON mcp_tokens (refresh_hash);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON mcp_tokens (user_id);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id         TEXT PRIMARY KEY,
  token_id   TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id  TEXT,
  tool       TEXT NOT NULL,
  target     TEXT,
  status     INTEGER,
  ok         INTEGER NOT NULL,
  note       TEXT,
  ms         INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_calls_created_idx ON mcp_calls (created_at);
CREATE INDEX IF NOT EXISTS mcp_calls_user_idx ON mcp_calls (user_id, created_at);

ALTER TABLE mcp_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_calls ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_access, mcp_access_requests, mcp_oauth_clients, mcp_auth_requests, mcp_oauth_codes, mcp_tokens, mcp_calls TO pos_app;
ALTER TABLE mcp_access OWNER TO pos_app;
ALTER TABLE mcp_access_requests OWNER TO pos_app;
ALTER TABLE mcp_oauth_clients OWNER TO pos_app;
ALTER TABLE mcp_auth_requests OWNER TO pos_app;
ALTER TABLE mcp_oauth_codes OWNER TO pos_app;
ALTER TABLE mcp_tokens OWNER TO pos_app;
ALTER TABLE mcp_calls OWNER TO pos_app;

-- Demo mode mirrors every pos table (0203). The connector's own requests never run in Demo mode (ai-connector is in
-- DEMO_LIVE in functions/api/_middleware.ts; /api/mcp is public), so its rows are always real.
select demo.sync();
