-- Phone number and 6-digit PIN sign-in for cleaners and technicians (owner, 23 Oct 2026). Field staff often have no
-- email, and sign-in was by email only, so a cleaner added to the roster could never get into the field app.
--
--   users.login_phone   the phone number a field account signs in with, digits only with the country code
--                       (60123456789). Set by "Give app access" on the Cleaners page; empty for everyone else.
--                       The PIN is stored where the password is (users.password_hash), so lockout, sign-in records
--                       and "must change on first sign-in" all work as they do for passwords.
--                       A phone-only account still needs an email (users.email is required and unique): it gets
--                       <user id>@no-email.invalid, an address that can never receive mail (.invalid is reserved).
--   login_events.method gains 'pin'.
--
-- Optional: the code reads login_phone only when it exists; without it phone sign-in answers "wrong phone or PIN".
--
-- REVERSAL: DROP INDEX users_login_phone_key; ALTER TABLE users DROP COLUMN login_phone;
--           DELETE FROM login_events WHERE method = 'pin'; then restore login_events_method_check without 'pin'.
--           Phone-only accounts stay, but can then sign in only through management's Reset password.
set local search_path = pos;

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_phone TEXT CHECK (login_phone IS NULL OR login_phone ~ '^[0-9]{8,15}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_login_phone_key ON users(login_phone) WHERE login_phone IS NOT NULL;

ALTER TABLE login_events DROP CONSTRAINT IF EXISTS login_events_method_check;
ALTER TABLE login_events ADD CONSTRAINT login_events_method_check CHECK (method IN ('password','totp','backup_code','reset_link','pin'));
