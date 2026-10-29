-- REVERSAL: alter table scm.petty_cash_floats drop column opening_on, drop column opening_sen;
-- A float can start with the cash its keeper already holds (finance, chew 29 Oct 2026; SOP 6): the floats exist before
-- the ERP does, so at go-live each one starts from the cash counted in the keeper's hands, and the first top-up only
-- makes up the rest. Nothing is booked for it: the float account's balance comes in with the opening balances (SOP 7.1).
--   scm.petty_cash_floats.opening_sen   cash held when the float started on the ERP (sen), 0 for a new float
--   scm.petty_cash_floats.opening_on    the day it was counted
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.petty_cash_floats add column if not exists opening_sen bigint not null default 0 check (opening_sen >= 0);
alter table scm.petty_cash_floats add column if not exists opening_on date;
