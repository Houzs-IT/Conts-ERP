-- The 15-minute email / WhatsApp job claims a message before it sends it (11 Oct 2026). Until now the job read the
-- due rows and sent them, so two runs at once (a cron fired twice, or the job and the request that just queued the
-- message) could each send the same message. Optional: the code reads this column only when it exists, and without it
-- behaves as before.
--
--   notification_log.sending_until  set while one run (or the request that wrote the row) is sending the message; other
--                                   runs leave the row alone until then. Cleared when the send finishes. A run that
--                                   died mid-send leaves a time in the past, so the next run picks the row up again.
--                                   The row's state (queued / sent / failed) is unchanged, so screens read as before.
--
-- REVERSAL: ALTER TABLE notification_log DROP COLUMN sending_until;
set local search_path = pos;

ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS sending_until TEXT;
