-- REVERSAL: drop table public.project_step_sla; alter table public.project_flow_steps drop column sla_days;
-- SLA per project step (owner, 16 Oct 2026). Project Maintenance sets how many days each step may take (blank = no
-- SLA); a project copies that number when it enters the step, and can have its own number for any of its steps.
-- The project page shows days in the current step against the days allowed, and "Overdue by N days" when over; the
-- project list has an Overdue badge and filter; the calendar ends a project without a planned handover on its start
-- date plus the days allowed for its steps. No notifications (the engine runs no scheduled jobs).
--
-- * project_flow_steps.sla_days: the company default per step, whole days, null = no SLA.
-- * project_step_sla: one row per project and step, written by the engine
--   (engine/backend/src/services/renovation/stepSla.ts):
--     entered_on  the day the project entered the step (null while only its days were set ahead of time)
--     sla_days    the days allowed for this project in this step
--     sla_source  'default' = copied from Project Maintenance when the step was entered,
--                 'project' = set on the project page, null = nothing copied yet (no default existed then)
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_flow_steps
  add column sla_days integer check (sla_days is null or sla_days between 1 and 3650);

create table public.project_step_sla (
  project_id bigint not null references public.projects(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  step_key text not null,
  entered_on date,
  sla_days integer check (sla_days is null or sla_days between 1 and 3650),
  sla_source text check (sla_source in ('default', 'project')),
  updated_by bigint,
  updated_at timestamptz not null default now(),
  primary key (project_id, step_key)
);

create index project_step_sla_company on public.project_step_sla (company_id);

alter table public.project_step_sla owner to scm_engine;
alter table public.project_step_sla enable row level security;
revoke all on public.project_step_sla from anon, authenticated;
