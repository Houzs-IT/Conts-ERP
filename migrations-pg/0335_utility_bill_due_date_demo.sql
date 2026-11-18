-- Demo mode's views follow the new column (migration 0334, pos.utility_bill_scans.due_date): Demo mode reads the
-- scans through its combined views, which only carry the columns they had when they were built, so a bill sent to
-- finance from Demo mode failed on the missing due_date. demo.sync() rebuilds them from the tables as they are now.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0335, dry run first.
-- REVERSAL: none needed (the views are rebuilt from the tables; select demo.sync() again after any reversal of 0334).
set local search_path = pos;

select demo.sync();
