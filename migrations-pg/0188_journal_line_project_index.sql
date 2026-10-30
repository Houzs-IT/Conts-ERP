-- REVERSAL: drop index scm.journal_entry_lines_project;
-- Booked cost by project (finance, chew 31 Oct 2026; plan docs/superpowers/plans/2026-10-31-renovation-completion-dashboard.md
-- Task 1). Cost postings now stamp scm.journal_entry_lines.project_id (the column already exists, nothing filled it); the
-- renovation completion % reads each project's booked cost through this index.
-- Numbered 0188: 0187 (einvoice_ready) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create index if not exists journal_entry_lines_project on scm.journal_entry_lines (company_id, project_id) where project_id is not null;
