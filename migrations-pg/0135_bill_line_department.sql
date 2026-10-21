-- REVERSAL: alter table scm.ap_invoice_lines drop column if exists department; alter table scm.acc_debtor_bill_lines drop column if exists department;
-- The department on AP invoice and debtor bill lines (finance, 21 Oct 2026; docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md 3.5):
--  * the same Rental / Supply chain / Shared choice migration 0134 put on journal, payment voucher and receipt lines;
--    an other creditor's rent or service bill is often a Rental or Shared cost.
--  * Every existing line, and any line written without one, is Supply chain.
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.ap_invoice_lines
  add column if not exists department text not null default 'supply' check (department in ('rental', 'supply', 'shared'));
alter table scm.acc_debtor_bill_lines
  add column if not exists department text not null default 'supply' check (department in ('rental', 'supply', 'shared'));

-- PostgREST reads the new column only after its schema cache reloads.
notify pgrst, 'reload schema';
