-- Category-first permissions (functions/_lib/access.ts). Category baselines are stored as rows whose area is
-- 'group:<Category>' and need nothing new. A module row may now hold 'inherit': follow the category baseline even
-- where the built-in rule gives that module its own override (Invoices and payments, Ledger, Communication, Users).
-- REVERSAL: DELETE FROM pos.role_access WHERE level = 'inherit'; then restore the CHECK without 'inherit'.
set local search_path = pos;

ALTER TABLE role_access DROP CONSTRAINT role_access_level_check;
ALTER TABLE role_access ADD CONSTRAINT role_access_level_check CHECK (level IN ('none','view','edit','full','inherit'));
