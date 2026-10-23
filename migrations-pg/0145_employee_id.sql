-- Cleaners and technicians sign in with an employee ID and their PIN, not a phone number (owner, 23 Oct 2026).
--
--   users.employee_id   EMP-001, EMP-002, ... given by "Give app access" on Workers, field accounts only. Its presence
--                       marks a PIN account (the PIN is in users.password_hash). Never reused: numbers come from
--                       employee_id_seq. Three digits up to EMP-999, then EMP-1000 and on.
--   users.login_phone   (migration 0143) dropped: phone sign-in is not a second way in. It was only ever on staging.
--
-- Everyone who had phone sign-in gets an employee ID first, oldest account first, so nobody is locked out.
-- Optional: the code reads employee_id only when it exists; without it field sign-in answers "wrong ID or PIN".
--
-- REVERSAL: DROP INDEX users_employee_id_key; ALTER TABLE users DROP COLUMN employee_id; DROP SEQUENCE employee_id_seq;
--           (the dropped login_phone numbers are not restored; give those people a new PIN instead)
set local search_path = pos;

CREATE SEQUENCE IF NOT EXISTS employee_id_seq;
ALTER SEQUENCE employee_id_seq OWNER TO pos_app;

ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT CHECK (employee_id IS NULL OR employee_id ~ '^EMP-[0-9]{3,}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_key ON users(employee_id) WHERE employee_id IS NOT NULL;

DO $$ DECLARE r record; n bigint; BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'pos' AND table_name = 'users' AND column_name = 'login_phone') THEN
    FOR r IN EXECUTE 'SELECT id FROM pos.users WHERE login_phone IS NOT NULL AND employee_id IS NULL ORDER BY created_at, id' LOOP
      n := nextval('pos.employee_id_seq');
      UPDATE pos.users SET employee_id = 'EMP-' || CASE WHEN n < 1000 THEN lpad(n::text, 3, '0') ELSE n::text END WHERE id = r.id;
    END LOOP;
  END IF;
END $$;

DROP INDEX IF EXISTS users_login_phone_key;
ALTER TABLE users DROP COLUMN IF EXISTS login_phone;
