-- The quiet-hours drainer (worker/scheduled.ts) was marking a queued notification "sent" at
-- 08:00 without ever actually delivering it, because notification_log never stored the subject
-- or body needed to retry the send — only the recipient/channel/template. This adds the content
-- so the drainer can call the real provider, same as an immediate send does.
-- Nullable: existing rows (already marked sent or failed with no retry needed) stay as they are.
-- REVERSAL: ALTER TABLE notification_log DROP COLUMN subject, DROP COLUMN body;
set local search_path = pos;

ALTER TABLE notification_log ADD COLUMN subject TEXT;
ALTER TABLE notification_log ADD COLUMN body    TEXT;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
