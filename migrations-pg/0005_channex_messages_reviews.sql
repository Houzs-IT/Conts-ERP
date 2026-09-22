-- Links a conversation, one of its messages, or a review back to the Channex record it came
-- from, so a later pull recognises what it has already seen instead of duplicating it. Null for
-- anything created locally (a direct-guest WhatsApp thread, a manual reply).
-- REVERSAL: DROP INDEX pos.message_threads_channex_thread_id_key; ALTER TABLE message_threads DROP COLUMN channex_thread_id;
--           DROP INDEX pos.messages_channex_message_id_key; ALTER TABLE messages DROP COLUMN channex_message_id;
--           DROP INDEX pos.reviews_channex_review_id_key; ALTER TABLE reviews DROP COLUMN channex_review_id;
set local search_path = pos;

ALTER TABLE message_threads ADD COLUMN channex_thread_id TEXT;
CREATE UNIQUE INDEX message_threads_channex_thread_id_key ON message_threads(channex_thread_id) WHERE channex_thread_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN channex_message_id TEXT;
CREATE UNIQUE INDEX messages_channex_message_id_key ON messages(channex_message_id) WHERE channex_message_id IS NOT NULL;

ALTER TABLE reviews ADD COLUMN channex_review_id TEXT;
CREATE UNIQUE INDEX reviews_channex_review_id_key ON reviews(channex_review_id) WHERE channex_review_id IS NOT NULL;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'pos' loop
    execute format('alter table pos.%I owner to pos_app', t);
    execute format('alter table pos.%I enable row level security', t);
  end loop;
end $$;
