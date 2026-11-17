-- REVERSAL: alter table scm.acc_company_settings drop column if exists documents_cutover_date;
-- The documents' cut-over (chew, 17 Nov 2026): the books start on 2026-09-01, but AutoCount kept them until 16 Nov, its
-- ledger brought in as journals. The invoices customers owe and the bills the company owes are then AutoCount's as at
-- 16 Nov, not 31 Aug: this is that day. The opening check compares the controls with the documents on it, and the
-- opening lists may carry documents dated up to it. Null: the opening day (the day before the books start).
-- APPLY: by the migrate-production workflow, only=0333, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.acc_company_settings add column if not exists documents_cutover_date date;

notify pgrst, 'reload schema';
