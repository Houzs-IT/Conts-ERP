-- REVERSAL: select demo.drop_views(); drop table public.project_line_progress; select demo.sync();
-- Renovation line ticks (owner, 16 Nov 2026, PLAN-reno-portal.md step 2): the crew, or the office for them, tick each
-- Works and Built-in sales order line as it is finished. A row means the line is done; unticking deletes the row, so
-- there is no status column to drift. When every line of a trade on a project is ticked, the engine completes that
-- trade's site task (project_trade_tasks), so the calendar, the Site tab and the board read Done with no second step.
-- Lines of a cancelled sales order keep their rows; the board reads only live lines.
--
-- APPLY: staging first (node scripts/migrate-pg.mjs --only=0329), production through the workflow "Apply migrations to
-- production" with only=0329, dry run first. The tick buttons answer "not switched on yet" until it is applied.
select demo.drop_views();
set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.project_line_progress (
  so_item_id uuid primary key references scm.mfg_sales_order_items(id) on delete cascade,
  project_id bigint not null references public.projects(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  done_at timestamptz not null default now(),
  done_by_user_id bigint,
  done_by_person_id bigint references public.project_people(id) on delete set null
);
create index if not exists project_line_progress_project_idx on public.project_line_progress (project_id);

alter table public.project_line_progress owner to scm_engine;
alter table public.project_line_progress enable row level security;
revoke all on public.project_line_progress from anon, authenticated;
grant all on public.project_line_progress to service_role;

select demo.sync();
