-- Dream Crafter staff get the phone app (Dream Crafter field access): an employee ID and PIN sign-in at /portal and clock-in
-- with a selfie, as The Conts' cleaners and technicians have.
--
--   dc_staff.user_id     the phone login given to a Dream Crafter employee ("Give app access"), one login per person.
--   dc_staff.is_active   switched on or off from Employee Master; off stops the login at once.
--   users.role           gains 'renovator', the login role of Dream Crafter's own staff (Clock and Me in the app).
--   departments.kind     gains 'renovation', and a department "Renovation crew" of that kind on the Dream Crafter side
--                        holds those logins. The existing Renovation department is kind 'staff' (desk logins), so it is
--                        left alone.
--
-- The two CHECKs were written inline in 0001 and 0145 with no name the code relies on, so each is found by what it says,
-- as 0185 does. None found means the table is not what this file expects: stop rather than leave both rules on.
--
-- Optional: the code reads dc_staff.user_id and is_active only when they exist; without this migration Employee Master keeps
-- working and the app access buttons do not show.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0311, dry run first.
-- REVERSAL, in this order (renovator logins and the Renovation crew rows block the CHECKs and the delete otherwise):
--   ALTER TABLE pos.dc_staff DROP COLUMN is_active, DROP COLUMN user_id;
--   UPDATE pos.users SET role = 'technician', is_active = 0, department_id = NULL, position_id = NULL WHERE role = 'renovator';
--     (switched off, so they cannot sign in; view-as test accounts included)
--   DELETE FROM pos.positions WHERE department_id IN (SELECT id FROM pos.departments WHERE kind = 'renovation');
--   DELETE FROM pos.departments WHERE kind = 'renovation';
--   ALTER TABLE pos.departments DROP CONSTRAINT departments_kind_check;
--   ALTER TABLE pos.departments ADD CONSTRAINT departments_kind_check CHECK (kind IN ('management','staff','cleaning','maintenance'));
--   ALTER TABLE pos.users DROP CONSTRAINT users_role_check;
--   ALTER TABLE pos.users ADD CONSTRAINT users_role_check CHECK (role IN ('management','operations_manager','operations_staff','finance_admin','housekeeper','technician','owner'));
set local search_path = pos;

ALTER TABLE dc_staff ADD COLUMN IF NOT EXISTS user_id TEXT UNIQUE REFERENCES users(id);
ALTER TABLE dc_staff ADD COLUMN IF NOT EXISTS is_active SMALLINT NOT NULL DEFAULT 1;

DO $$
DECLARE c text; dropped int := 0;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) = 'CHECK ((role = ANY (ARRAY[''management''::text, ''operations_manager''::text, ''operations_staff''::text, ''finance_admin''::text, ''housekeeper''::text, ''technician''::text, ''owner''::text])))'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c);
    dropped := dropped + 1;
  END LOOP;
  IF dropped = 0 THEN RAISE EXCEPTION 'users: the role check from 0001 was not found'; END IF;
END $$;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('management','operations_manager','operations_staff','finance_admin','housekeeper','technician','renovator','owner'));

DO $$
DECLARE c text; dropped int := 0;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'departments'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) = 'CHECK ((kind = ANY (ARRAY[''management''::text, ''staff''::text, ''cleaning''::text, ''maintenance''::text])))'
  LOOP
    EXECUTE format('ALTER TABLE departments DROP CONSTRAINT %I', c);
    dropped := dropped + 1;
  END LOOP;
  IF dropped = 0 THEN RAISE EXCEPTION 'departments: the kind check from 0145 was not found'; END IF;
END $$;
ALTER TABLE departments ADD CONSTRAINT departments_kind_check CHECK (kind IN ('management','staff','cleaning','maintenance','renovation'));

-- The name is unique ignoring case (departments_name_unique), so there is never a second Renovation crew.
INSERT INTO departments (name, kind, side, sort) VALUES ('Renovation crew', 'renovation', 'dream_crafter', 95)
ON CONFLICT DO NOTHING;
