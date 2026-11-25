-- 0380_mcp_pending_actions: AI Connector actions, owner 26 Nov 2026 ("先确认再做", confirm first, then do). The connector
-- may now book a meeting and send an email for the signed-in person, never orders, money, stock, approvals or deletes.
-- An AI app first PROPOSES the action (propose_meeting / propose_email); the proposal is stored here with a plain
-- summary for 10 minutes; only confirm_action, after the person said yes in the chat, performs it, once, through the
-- ERP's own Meetings and Mail Center endpoints as that person (functions/_lib/mcpActions.ts, mcpServer.ts).
-- Additive only: one new table, no existing table or row changes. Needs 0378 (the connector's own tables).
--
--   mcp_pending_actions  one proposal: whose (token and person), what kind, the exact payload confirm_action sends,
--                        the summary the person was shown, when it lapses, when it was used and what came of it.
--
-- Until this is applied propose_* answer "AI actions are not set up on this system yet" (mcpActionsReady); reads and
-- every other connector tool are unaffected. The switch that turns actions on (settings key mcp.actionsEnabled, default
-- off) lives in the existing settings table, so nothing else is needed.
--
-- REVERSAL (revert the code first):
--   drop table if exists pos.mcp_pending_actions;
--   select demo.sync();
-- GRANTS: pos_app owns the table (as 0378), so nothing to re-apply.

set local search_path = pos;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mcp_pending_actions (
  id           TEXT PRIMARY KEY,
  token_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('meeting', 'email')),
  payload_json TEXT NOT NULL,
  summary      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  -- what came of it: done / failed (confirmed), cancelled; null while it waits
  outcome      TEXT CHECK (outcome IS NULL OR outcome IN ('done', 'failed', 'cancelled')),
  result       TEXT
);
CREATE INDEX IF NOT EXISTS mcp_pending_actions_user_idx ON mcp_pending_actions (user_id, used_at);
CREATE INDEX IF NOT EXISTS mcp_pending_actions_expires_idx ON mcp_pending_actions (expires_at);

ALTER TABLE mcp_pending_actions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_pending_actions TO pos_app;
ALTER TABLE mcp_pending_actions OWNER TO pos_app;

-- Demo mode mirrors every pos table (0203). The connector's own requests never run in Demo mode, so its rows are real.
select demo.sync();
