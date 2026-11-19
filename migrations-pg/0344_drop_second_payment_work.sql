-- REVERSAL: insert the row back as migration 0342 seeds it (code payment_2, rule payment_2, in_design, sort_order 40, system).
-- Owner, 19 Nov 2026: Second payment is not a Design work. The payment is read from the sales order's receipts where it
-- matters (the stages), so the row leaves Design work, Design progress and the Design steps.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0344, dry run first.

set local search_path = public, scm, extensions;
set local lock_timeout = '5s';

delete from public.project_work_types where code = 'payment_2';
