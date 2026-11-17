-- Renovation app access (owner, 12 Nov 2026): a Renovation employee gets an employee ID and PIN like a cleaner or
-- technician. Their app has nothing built yet: it says so and offers Settings and Log out.
--
--   users.role            gains 'renovator', the login "Give app access" makes for a Renovation employee.
--   renovators            gains employment_type, always 'internal': the shared Give app access step checks it, and
--                         Renovation has no outside companies.
--
-- Optional: Give app access on a Renovation employee answers NOT_MIGRATED until this is applied.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0316, dry run first.
-- REVERSAL (only once no renovator logins are wanted):
--   UPDATE pos.renovators SET user_id = NULL WHERE user_id IN (SELECT id FROM pos.users WHERE role = 'renovator');
--   DELETE FROM pos.users WHERE role = 'renovator';
--   ALTER TABLE pos.users DROP CONSTRAINT users_role_check;
--   ALTER TABLE pos.users ADD CONSTRAINT users_role_check CHECK (role IN ('management','operations_manager',
--     'operations_staff','finance_admin','housekeeper','technician','owner'));
--   ALTER TABLE pos.renovators DROP COLUMN employment_type;
--   select demo.sync();
set local search_path = pos;

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('management','operations_manager','operations_staff',
  'finance_admin','housekeeper','technician','renovator','owner'));

ALTER TABLE renovators ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT 'internal'
  CHECK (employment_type = 'internal');

select demo.sync();
