-- 0397_mcp_brief_alerts: AI Connector round 4d, owner 26 Nov 2026 ("加 全部一起做"): the morning brief email, urgent
-- alerts, and the data gaps list in the Monday brief. Each person opts in for themselves on System > AI Connector (off by
-- default); every brief and alert is built AS that person with a short-lived connector token of their own
-- (functions/_lib/mcpProactiveRun.ts) and sent through the existing outbox (notification_log).
-- Additive only: three new tables, no existing table, column or row changes.
--
--   mcp_brief_subscriptions  one row per person who saved the settings: brief on/off, time, weekdays/daily, alerts on/off,
--                            the random token in the email's unsubscribe link, when their alerts were last checked.
--   mcp_proactive_keys       the debounce / idempotency ledger: one row per person + key + Malaysia day ("brief", or an
--                            alert key such as maintenance:<id>). Claimed with INSERT ... ON CONFLICT DO NOTHING
--                            RETURNING before anything is sent, so a repeated tick sends nothing twice.
--   mcp_proactive_sends      the send log: who, what kind, how many items, the notification_log id, the result. Never
--                            the subject or the body of the email.
--
-- Until this is applied the tick answers "not set up here yet" and sends nothing (mcpProactiveStore.ts proactiveReady),
-- and the AI Connector page's email section says so; nothing else reads these tables.
--
-- REVERSAL (revert the code first; it reads every table):
--   drop table if exists pos.mcp_proactive_sends, pos.mcp_proactive_keys, pos.mcp_brief_subscriptions;
--   select demo.sync();
-- GRANTS: pos_app owns the tables (as 0378), so nothing to re-apply.

set local search_path = pos;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mcp_brief_subscriptions (
  user_id             TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  brief_enabled       INTEGER NOT NULL DEFAULT 0,
  brief_time          TEXT NOT NULL DEFAULT '08:00',
  brief_days          TEXT NOT NULL DEFAULT 'weekdays' CHECK (brief_days IN ('weekdays', 'daily')),
  alerts_enabled      INTEGER NOT NULL DEFAULT 0,
  unsub_token         TEXT NOT NULL,
  last_alert_check_at TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_brief_subscriptions_unsub_idx ON mcp_brief_subscriptions (unsub_token);

CREATE TABLE IF NOT EXISTS mcp_proactive_keys (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_key  TEXT NOT NULL,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, alert_key, day)
);
CREATE INDEX IF NOT EXISTS mcp_proactive_keys_day_idx ON mcp_proactive_keys (alert_key, day);

CREATE TABLE IF NOT EXISTS mcp_proactive_sends (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('brief', 'brief_test', 'alert', 'unsubscribe')),
  day             TEXT NOT NULL,
  items           INTEGER,
  notification_id TEXT,
  status          TEXT NOT NULL,
  note            TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_proactive_sends_user_idx ON mcp_proactive_sends (user_id, created_at);

ALTER TABLE mcp_brief_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_proactive_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_proactive_sends ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_brief_subscriptions, mcp_proactive_keys, mcp_proactive_sends TO pos_app;
ALTER TABLE mcp_brief_subscriptions OWNER TO pos_app;
ALTER TABLE mcp_proactive_keys OWNER TO pos_app;
ALTER TABLE mcp_proactive_sends OWNER TO pos_app;

-- Demo mode mirrors every pos table (0203). The tick and the unsubscribe link never run in Demo mode (/api/mcp is public),
-- so their rows are always real.
select demo.sync();
