-- REVERSAL: alter table scm.acc_receipt_lines remove the project_id and unit_id columns.
-- A Money received line names the project or unit it is for (finance, chew 2 Nov 2026; plan
-- docs/superpowers/plans/2026-11-02-renovation-close-out.md Task 1), as voucher lines do: a building deposit coming
-- back is credited to its project, so the close-out check sees the project's deposit balance clear.
--   scm.acc_receipt_lines.project_id  public.projects id, carried to journal_entry_lines.project_id
--   scm.acc_receipt_lines.unit_id     public.conts_units id (Rental lines only), carried to journal_entry_lines.unit_id
-- Numbered 0195: 0194 (ledger_unit) is the last on production; 0193 is on main, not yet applied.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.acc_receipt_lines
  add column if not exists project_id bigint,
  add column if not exists unit_id text;

notify pgrst, 'reload schema';
