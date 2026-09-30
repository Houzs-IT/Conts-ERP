-- Channex refuses an ARI call that touches more than one property, and its rate limit is per property,
-- so the outbox sends one call per property and kind; the call log records which property it was for.
-- REVERSAL: ALTER TABLE channex_calls DROP COLUMN property_id;
set local search_path = pos;

ALTER TABLE channex_calls ADD COLUMN property_id TEXT;
CREATE INDEX idx_chx_calls_property ON channex_calls (property_id, kind, called_at);

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
