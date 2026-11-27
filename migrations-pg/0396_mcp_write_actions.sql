-- 0396_mcp_write_actions: AI Connector round 4b, owner 26 Nov 2026 ("那些也ok"). Two more confirm-first actions: reply to
-- a Mail Center email (propose_mail_reply) and add a note to a reservation or a cleaning job (propose_note). Same two
-- steps as 0380: the proposal is stored here for 10 minutes, and only confirm_action, after the person said yes, makes
-- the ONE write through the ERP's own endpoint as that person (functions/_lib/mcpWrite.ts).
--
-- Why a migration: 0380 created mcp_pending_actions.kind with CHECK (kind IN ('meeting', 'email')), so a proposal of any
-- other kind cannot be stored. This only widens that list. Additive: no row changes, no new table or column.
--
-- Until this is applied the two new tools answer "not set up on this system yet (migration 0396)" (mcpStore.ts
-- writeKindsReady), their switches on System > AI Connector stay disabled, and they are hidden from tools/list;
-- meetings, email and every read tool are unaffected. Each new action also has its own switch (settings keys
-- mcp.action.mail_reply / mcp.action.note, default off), effective only while "Allow AI actions" is on.
--
-- REVERSAL (revert the code first; refused while rows of the new kinds exist, delete those first):
--   alter table pos.mcp_pending_actions drop constraint if exists mcp_pending_actions_kind_check;
--   alter table pos.mcp_pending_actions add constraint mcp_pending_actions_kind_check check (kind in ('meeting', 'email'));
--   select demo.sync();
-- GRANTS: unchanged (pos_app owns the table, 0380).

set local search_path = pos;
set local lock_timeout = '5s';

ALTER TABLE mcp_pending_actions DROP CONSTRAINT IF EXISTS mcp_pending_actions_kind_check;
ALTER TABLE mcp_pending_actions ADD CONSTRAINT mcp_pending_actions_kind_check
  CHECK (kind IN ('meeting', 'email', 'mail_reply', 'reservation_note', 'cleaning_note'));

-- Demo mode mirrors every pos table (0203). The connector's own requests never run in Demo mode, so its rows are real.
select demo.sync();
