-- REVERSAL: alter table scm.reno_beta_line_plans drop column supplier_id;
-- The supplier a project's SO line is to be bought from, picked on the project's SO tab for any line, contract or not
-- (owner, 4 Nov 2026: "like my MRP"). MRP starts the line on this supplier. Empty: the SKU's main supplier, as before.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, select demo.drop_views() first and
-- select demo.sync() last; staging first, then production, BEFORE the code that needs it merges.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_beta_line_plans add column supplier_id uuid references scm.suppliers(id) on delete set null;

notify pgrst, 'reload schema';
