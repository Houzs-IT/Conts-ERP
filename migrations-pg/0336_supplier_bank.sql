-- REVERSAL: alter table scm.suppliers drop column if exists bank_name, drop column if exists bank_account_no, drop column if exists bank_account_name;
-- Where a supplier is paid (chew, 18 Nov 2026: the payment voucher list shows the account the money goes to; suppliers
-- had no bank on record). Kept on the supplier record and edited on its page; the voucher list reads them through the
-- voucher's supplier. The list view (suppliers_with_derived_category) is not changed: the list does not show them.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0336, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.suppliers
  add column if not exists bank_name text,
  add column if not exists bank_account_no text,
  add column if not exists bank_account_name text;

notify pgrst, 'reload schema';
