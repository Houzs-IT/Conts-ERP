-- REVERSAL: drop table scm.acc_debtor_control_map;
-- Which control a new customer is opened under, by the kind of order that brings them (finance phase 1.5, spec
-- 2.3; SOP 2.1): a renovation contract → 301-0000, an inhouse renovation → 302-0000, rental → 303-0000. A kind with
-- no row (a standard sales order, until finance says) opens the customer under the AR rule. Finance changes the
-- rows; a customer's own control can be changed on Debtors afterwards.
-- APPLY: by hand, to production before the code merges (no staging: finance, 21 Oct 2026); one transaction with its
--   public.pos_migrations row, as scripts/migrate-pg.mjs writes it.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.acc_debtor_control_map (
  company_id bigint not null references public.companies(id),
  order_kind text not null check (order_kind in ('RENOVATION', 'INHOUSE_RENOVATION', 'STANDARD', 'RENTAL')),
  control_account text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, order_kind)
);
alter table scm.acc_debtor_control_map owner to scm_engine;
alter table scm.acc_debtor_control_map enable row level security;
revoke all on scm.acc_debtor_control_map from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.acc_debtor_control_map to service_role, pos_app;

insert into scm.acc_debtor_control_map (company_id, order_kind, control_account)
select c.id, m.kind, m.control
  from public.companies c
  cross join (values ('RENOVATION', '301-0000'), ('INHOUSE_RENOVATION', '302-0000'), ('RENTAL', '303-0000')) as m(kind, control)
 where c.id = 1
on conflict do nothing;

notify pgrst, 'reload schema';
