-- REVERSAL: DROP TABLE pos.saved_replies; ALTER TABLE pos.messages DROP COLUMN attachments; ALTER TABLE pos.message_threads DROP COLUMN unit_id, DROP COLUMN guest_name, DROP COLUMN channex_seen_at; ALTER TABLE pos.reviews DROP COLUMN guest_name, DROP COLUMN scores, DROP COLUMN channel_reply, DROP COLUMN channel_replied_at, DROP COLUMN channex_updated_at, DROP COLUMN reply_push_state, DROP COLUMN reply_push_error; (and ALTER TABLE pos.reviews ALTER COLUMN unit_id SET NOT NULL once no review is left without a unit)
-- Messages and Reviews pulled from Airbnb and Booking.com through Channex (owner, 2 Nov 2026). New columns are empty
-- until the next pull fills them; nothing existing changes meaning.
--   reviews.unit_id               may now be empty: a review Channex cannot tie to a booking or a single unit is kept
--                                 ("No booking matched") instead of being skipped.
--   reviews.guest_name            the name Channex gives, for a review with no booking behind it.
--   reviews.scores                Booking.com's category scores as [{"category": "...", "score": 0-10}], when given.
--   reviews.channel_reply / channel_replied_at   the reply as it stands on the channel's own site (written there, or
--                                 posted from here and echoed back).
--   reviews.channex_updated_at    Channex's own updated_at, so a pull rewrites a review only when the guest edited it
--                                 or a reply was posted on the site.
--   reviews.reply_push_state / reply_push_error  whether the reply saved here reached the channel: sent | failed.
--                                 Empty for a review that is not linked to a channel (nothing to post to).
--   message_threads.unit_id       the unit of a conversation with no booking (an Airbnb inquiry before booking).
--   message_threads.guest_name    the name Channex gives, for a conversation with no guest record.
--   message_threads.channex_seen_at  the thread's last change on Channex already read, so the scheduled pull only
--                                 asks for the messages of a conversation that changed.
--   messages.attachments          files the guest sent, as [{"url": "...", "name": "..."}], when Channex gives them.
--   saved_replies                 the short replies staff insert into a message (Messages > Saved replies).
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0199.
set local search_path = pos;
set local lock_timeout = '5s';

ALTER TABLE reviews ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS scores JSONB;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS channel_reply TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS channel_replied_at TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS channex_updated_at TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_push_state TEXT CHECK (reply_push_state IS NULL OR reply_push_state IN ('sent','failed'));
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reply_push_error TEXT;

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS unit_id TEXT REFERENCES units(id) ON DELETE SET NULL;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS channex_seen_at TEXT;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;

CREATE TABLE IF NOT EXISTS saved_replies (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE saved_replies OWNER TO pos_app;
ALTER TABLE saved_replies ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON saved_replies TO pos_app;
