-- Staff comment sheet, OPERATION and Sheet3 (16 Oct 2026, owner clarification 17 Oct): maintenance job types, severity
-- and parts for the owner-approval rules, a due date for Normal jobs, cleaning prices and external cleaning jobs.
--
--   maintenance_issues.job_type          pass_key | urgent | normal. Backfilled from urgency, which stays in step
--                                        (urgent <-> 'urgent', the other two <-> 'normal').
--   maintenance_issues.severity          minor | major: one of the things management's approval rules can look at.
--   maintenance_issues.needs_parts       1 when the job waits for parts or stock to arrive.
--   maintenance_issues.parts_arrived_at  when the office ticked "Parts arrived".
--                                        A job that needs the owner's approval stays out of the technicians' app until
--                                        owner_approved_at is set and, when it needs parts, they have arrived.
--   maintenance_issues.due_on            YYYY-MM-DD the job should be done by; Normal jobs are worked in this order.
--   cleaning_prices, unit_cleaning_prices, tasks.amount / cleaner_pay / external_*: see below.
--
-- The approval rules themselves are one settings row (maintenance.approvalRules), written from Maintenance > Approval rules.
-- Optional: the code reads and writes these only when they exist (hasColumn); without them maintenance has Normal and
-- Urgent only and the other screens hide the new fields.
--
-- REVERSAL: delete from tasks where unit_id is null; alter table tasks drop constraint tasks_unit_or_address,
--           drop column amount, drop column cleaner_pay, drop column external_address, drop column external_client,
--           drop column external_phone, alter column unit_id set not null; drop table unit_cleaning_prices, cleaning_prices;
--           alter table maintenance_issues drop column job_type, drop column severity, drop column needs_parts,
--           drop column parts_arrived_at, drop column due_on; delete from settings where key = 'maintenance.approvalRules';
set local search_path = pos;

alter table maintenance_issues add column if not exists job_type text not null default 'normal';
alter table maintenance_issues add column if not exists severity text not null default 'minor';
alter table maintenance_issues add column if not exists needs_parts integer not null default 0;
alter table maintenance_issues add column if not exists parts_arrived_at text;
alter table maintenance_issues add column if not exists due_on text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_issues_job_type_check') then
    alter table maintenance_issues add constraint maintenance_issues_job_type_check check (job_type in ('pass_key','urgent','normal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'maintenance_issues_severity_check') then
    alter table maintenance_issues add constraint maintenance_issues_severity_check check (severity in ('minor','major'));
  end if;
end $$;
update maintenance_issues set job_type = 'urgent' where urgency = 'urgent' and job_type = 'normal';

-- Cleaning amounts (owner, 17 Oct 2026). Every clean has two numbers: the internal cost (what the cleaner is paid) and
-- the external charge (what is charged for the clean: the cleaning fee that goes on the unit's costs). They come from
-- the price table (clean type x unit layout), or a unit's own override; empty means "price not set" and the old
-- pricing stands. A finished clean keeps the figures it was charged at in tasks.amount / tasks.cleaner_pay.
create table if not exists cleaning_prices (
  kind            text not null check (kind in ('turnover','deep_clean','light_clean')),
  layout          text not null,
  internal_cost   integer check (internal_cost is null or internal_cost >= 0),
  external_charge integer check (external_charge is null or external_charge >= 0),
  updated_at      text not null,
  updated_by      text references users(id) on delete set null,
  primary key (kind, layout)
);
create table if not exists unit_cleaning_prices (
  unit_id         text not null references units(id) on delete cascade,
  kind            text not null check (kind in ('turnover','deep_clean','light_clean')),
  internal_cost   integer check (internal_cost is null or internal_cost >= 0),
  external_charge integer check (external_charge is null or external_charge >= 0),
  updated_at      text not null,
  updated_by      text references users(id) on delete set null,
  primary key (unit_id, kind)
);

-- External cleaning jobs: a clean at an address that is not one of our units (it replaces a separate "outside jobs"
-- list). It has no unit, so every unit, cost and owner statement reader (all join units) leaves it out by itself.
alter table tasks alter column unit_id drop not null;
alter table tasks add column if not exists amount integer check (amount is null or amount >= 0);
alter table tasks add column if not exists cleaner_pay integer check (cleaner_pay is null or cleaner_pay >= 0);
alter table tasks add column if not exists external_address text;
alter table tasks add column if not exists external_client text;
alter table tasks add column if not exists external_phone text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_unit_or_address') then
    alter table tasks add constraint tasks_unit_or_address check (unit_id is not null or external_address is not null);
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['cleaning_prices', 'unit_cleaning_prices'] loop
    execute format('alter table %I owner to pos_app', t);
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to pos_app', t);
  end loop;
end $$;
