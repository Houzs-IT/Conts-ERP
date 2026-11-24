-- REVERSAL: alter table scm.ap_invoice_lines drop column if exists item_group;
-- The stock group an AP invoice line buys (chew, 18 Nov 2026): until every item has a stock code, goods bills are keyed
-- by account on AP invoices, and the group and its purchase account fill each other (scm.acc_item_group_accounts).
-- Blank for a line that is not goods (rent, a service). Kept as the group's code; no FK, like the bindings table.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0338, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.ap_invoice_lines add column if not exists item_group text;

notify pgrst, 'reload schema';
