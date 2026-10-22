-- REVERSAL: drop index if exists scm.sales_invoices_opening_docno_uq; drop index if exists scm.purchase_invoices_opening_docno_uq; alter table scm.sales_invoices drop column if exists opening_balance; alter table scm.purchase_invoices drop column if exists opening_balance;
-- Opening documents (finance, 22 Oct 2026; docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md 3.8 #2):
--  * the invoices customers still owe and the bills the company still owes on the day before the books start, imported
--    from AutoCount's outstanding lists. Their money is in the OPENING journal already, so they post nothing — but they
--    show in the ageing and a payment against one settles it (and posts as usual).
--  * linked_ac_docno holds AutoCount's document number; an import of the same number twice is refused by the index.
--  * Every existing invoice and bill is not an opening one.
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.sales_invoices add column if not exists opening_balance boolean not null default false;
alter table scm.purchase_invoices add column if not exists opening_balance boolean not null default false;

create unique index if not exists sales_invoices_opening_docno_uq
  on scm.sales_invoices (company_id, linked_ac_docno) where opening_balance;
create unique index if not exists purchase_invoices_opening_docno_uq
  on scm.purchase_invoices (company_id, linked_ac_docno) where opening_balance;

-- PostgREST reads the new columns only after its schema cache reloads.
notify pgrst, 'reload schema';
