-- 0375_reno_commission_locks: commission rates fixed once a month closes (owner, 25 Nov 2026).
--
-- The owner settles commission once a month and may pay a claim a year after the order. The figures were worked out
-- afresh on every read, so a later change to a scheme (a new tier, another manager) would have changed what an old
-- order pays. Once the month a part of a contract was sold in has ended (the order on its date, each VO on its own
-- date), the commission page writes one row here per part: who the salesperson and the manager were and the rate each
-- earns. From then on that part pays at these rates whatever the scheme says. The money itself still follows the
-- contract and the payments.
-- A lock is cleared only when the owner saves a scheme with "apply to closed months too" ticked.
--
-- REVERSAL:
--   drop table if exists scm.reno_commission_locks;

set local lock_timeout = '5s';

create table if not exists scm.reno_commission_locks (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null default 1,
  so_doc_no text not null references scm.mfg_sales_orders(doc_no),
  -- 'SO', the VO number, or 'OTHER' (credit notes and other changes, dated with the order)
  portion_ref text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  scheme_id uuid references scm.reno_commission_schemes(id),
  salesperson_id uuid references scm.staff(id),
  manager_staff_id uuid references scm.staff(id),
  month_sales_sen bigint not null default 0,
  sales_bp integer not null check (sales_bp between 0 and 10000),
  manager_bp integer not null check (manager_bp between 0 and 10000),
  locked_at timestamptz not null default now()
);
create unique index if not exists uq_reno_commission_locks_portion on scm.reno_commission_locks (company_id, so_doc_no, portion_ref);
create index if not exists idx_reno_commission_locks_scheme on scm.reno_commission_locks (scheme_id);

alter table scm.reno_commission_locks owner to scm_engine;
alter table scm.reno_commission_locks enable row level security;
grant all on scm.reno_commission_locks to pos_app, service_role;
revoke all on scm.reno_commission_locks from anon, authenticated;

notify pgrst, 'reload schema';
