-- REVERSAL: alter table scm.journal_entry_lines, scm.payment_voucher_lines, scm.acc_receipt_lines, scm.ap_invoice_lines, scm.acc_debtor_bill_lines, scm.staff_receipt_lines, scm.payment_request_lines drop column sub_department_id (each); drop table scm.acc_sub_departments;
-- Sub-departments (SOP 1.1; chew 4 Nov 2026; spec docs/superpowers/specs/2026-11-04-sub-departments-design.md). Each
-- ledger line names a sub-department under its department: Rental (general) / Maintenance / Cleaning under Rental,
-- Renovation (Dream Crafter) / In-house Reno (The Conts) under Renovation (`supply`), Company under Company (`shared`).
-- Finance keeps the list on Ledger setup. `department` stays as it is on every line; `sub_department_id` sits beside
-- it, and a line without one reads as its department's built-in row (fixed_key rental_general / dreamcrafter / company).
--   scm.acc_sub_departments   the list: its department, name, built-in key, the staff department it maps to
--   sub_department_id         on journal, voucher, receipt, AP invoice, debtor bill, staff receipt and request lines
-- APPLY: by hand, in one transaction with its public.pos_migrations row, after 0206.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table if not exists scm.acc_sub_departments (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  department text not null check (department in ('rental', 'supply', 'shared')),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- Built in: renamed and reordered, never retired; its department never changes.
  fixed_key text check (fixed_key in ('rental_general', 'dreamcrafter', 'theconts', 'company')),
  -- The Property OS staff department (public.conts_departments.id) whose people default to it.
  staff_department_id text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, fixed_key),
  unique (company_id, department, name)
);
alter table scm.acc_sub_departments owner to scm_engine;
alter table scm.acc_sub_departments enable row level security;
revoke all on scm.acc_sub_departments from anon, authenticated;
grant all on scm.acc_sub_departments to service_role, pos_app;

insert into scm.acc_sub_departments (company_id, department, name, fixed_key, sort)
select c.id, s.department, s.name, s.fixed_key, s.sort
  from public.companies c
  cross join (values
    ('rental', 'Rental (general)', 'rental_general', 10),
    ('supply', 'Renovation (Dream Crafter)', 'dreamcrafter', 10),
    ('supply', 'In-house Reno (The Conts)', 'theconts', 20),
    ('shared', 'Company', 'company', 10)
  ) as s(department, name, fixed_key, sort)
on conflict do nothing;

-- Maintenance and Cleaning: ordinary rows, mapped to the staff department of the same name where there is one.
insert into scm.acc_sub_departments (company_id, department, name, staff_department_id, sort)
select c.id, 'rental', s.name, (select d.id::text from public.conts_departments d where d.name = s.name limit 1), s.sort
  from public.companies c
  cross join (values ('Maintenance', 20), ('Cleaning', 30)) as s(name, sort)
on conflict do nothing;

alter table scm.journal_entry_lines   add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.payment_voucher_lines add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.acc_receipt_lines     add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.ap_invoice_lines      add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.acc_debtor_bill_lines add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.staff_receipt_lines   add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);
alter table scm.payment_request_lines add column if not exists sub_department_id uuid references scm.acc_sub_departments(id);

notify pgrst, 'reload schema';
