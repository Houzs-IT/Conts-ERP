-- 0357_acc_todo_settings: Finance's To do rule switches (ported from Houzs's 20261102T2100_acc_todo_tasks.sql, the
-- settings table only). Finance's To do (engine conts/finance-todo.ts) raises every job from the live books by its
-- built-in rules; To do rules (/scm/finance/rules, Ledger full) switches a rule off and its jobs stop showing.
--
--   scm.acc_todo_settings   one row per company: rules_off, the built-in rules switched off (their ids, e.g.
--                           'ap-due'). No row means every rule is on. Written by PUT /api/scm/accounting/todo/settings.
--
-- Houzs's tasks, routines, remarks, groups and custom rules (acc_todo_tasks, acc_todo_occurrences, acc_todo_remarks,
-- groups / custom_rules) are not ported.
--
-- REVERSAL: drop table if exists scm.acc_todo_settings;   (the switches go; every rule is on again)

set local lock_timeout = '5s';

create table if not exists scm.acc_todo_settings (
  company_id  bigint      primary key references public.companies(id),
  rules_off   text[]      not null default '{}',
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table scm.acc_todo_settings owner to scm_engine;
alter table scm.acc_todo_settings enable row level security;
revoke all on scm.acc_todo_settings from anon, authenticated;
grant all on scm.acc_todo_settings to service_role;
