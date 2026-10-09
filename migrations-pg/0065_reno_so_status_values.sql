-- REVERSAL: enum values cannot be dropped in place; unused values are harmless. To remove them, recreate scm.mfg_so_status without them once no row uses them.
-- Renovation sales orders (the contract of a renovation project) do not use the furniture fulfilment statuses.
-- Their life is Confirmed -> In progress -> Completed, then the shared Closed / Cancelled. Own file because a new
-- enum value cannot be used in the transaction that adds it.
alter type scm.mfg_so_status add value if not exists 'RENO_CONFIRMED';
alter type scm.mfg_so_status add value if not exists 'RENO_IN_PROGRESS';
alter type scm.mfg_so_status add value if not exists 'RENO_COMPLETED';
