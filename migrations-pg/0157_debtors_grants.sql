-- REVERSAL: revoke all on scm.debtors from service_role, pos_app;
-- The grants 0156 left out (22-24 Oct 2026): the engine reads and writes scm.debtors through the Supabase REST client,
-- which runs as service_role, so the table needs the same grants as the other ledger tables (scm.sales_invoices:
-- service_role and pos_app, all privileges). 0156 copied 0119's pattern, which suits a table the engine reaches only
-- through its own database connection (scm_engine), not through REST.
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

grant all on scm.debtors to service_role, pos_app;

notify pgrst, 'reload schema';
