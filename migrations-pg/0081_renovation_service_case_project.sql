-- REVERSAL: drop index public.assr_cases_project_idx; alter table public.assr_cases drop column project_id;
-- Warranty: a complaint after handover becomes a Service Case linked to its project, so the project's
-- warranty stage lists them.
set local search_path = public, extensions;

alter table public.assr_cases add column project_id bigint references public.projects(id) on delete set null;
create index assr_cases_project_idx on public.assr_cases (project_id) where project_id is not null;
