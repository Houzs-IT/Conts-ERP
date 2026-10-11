-- Whether a reply sent from the Inbox reached the guest (11 Oct 2026). Until now the messages table kept no delivery
-- state, so after a reload a reply WhatsApp refused, or one the guest's platform never received, read as sent.
-- Optional: the code writes and reads these columns only when they exist, and without them behaves as before.
--
--   messages.delivery_state  outbound replies sent from Property OS: sent | failed | queued | not_linked
--                            (not_linked: the conversation is not connected to the guest's platform, so it is
--                            saved here only). Empty for incoming messages and for replies sent before this column.
--   messages.delivery_error  the reason the channel gave when it was not delivered.
--
-- REVERSAL: ALTER TABLE messages DROP COLUMN delivery_state, DROP COLUMN delivery_error;
set local search_path = pos;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_state TEXT
  CHECK (delivery_state IS NULL OR delivery_state IN ('sent','failed','queued','not_linked'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error TEXT;
