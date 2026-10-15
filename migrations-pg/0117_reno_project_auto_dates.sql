-- REVERSAL: drop trigger trg_reno_project_start_date on public.projects; drop function public.reno_project_start_date(); (the backfilled start_date / end_date values stay; they were empty or replaced by the rule below and are not restored)
-- A renovation project's Start date and End date fill themselves (owner, 15 Oct 2026). Nobody types them; every
-- screen shows them read-only: the project's Customer info, the sales order's Order information (an SO shows its
-- project's dates), the project list and the calendar.
--
-- * Start date = the day the project was created, Malaysia time. The BEFORE INSERT trigger below fills it on every
--   create path (New project, project from an SO, the Notion importer) when the insert left it blank.
-- * End date = the day the project reached the Closed step, by hand (Move step) or by its data (closed_at, or
--   handed over and fully paid); cleared when it leaves Closed. The step is computed by the engine on every read
--   (engine/backend/src/services/renovation/flow.ts), so the engine writes the end date where it computes the step
--   (services/renovation/projectDates.ts), not a trigger.
-- * Both columns are text 'YYYY-MM-DD', as the projects table has always held them.
--
-- Backfill of existing renovation projects:
-- * start_date = the created day where it is empty.
-- * end_date for a project this SQL can tell is Closed (a hand-set Closed step, or closed_at with no hand-set step
--   holding it back) = the day of its latest step-history entry into Closed (project_flow_log), else its closed_at
--   day, else its last updated day. A project with no sign of closing at all (no closed_at, no handover) gets its
--   end_date cleared. The rest (handed over, maybe fully paid) is settled by the engine the first time the board, the
--   list or the project is read.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

create or replace function public.reno_project_start_date() returns trigger
language plpgsql as $$
begin
  if nullif(btrim(coalesce(new.start_date, '')), '') is null then
    new.start_date := to_char((coalesce(new.created_at::timestamptz, now()) at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD');
  end if;
  return new;
end
$$;

create trigger trg_reno_project_start_date
  before insert on public.projects
  for each row when (new.project_kind = 'renovation')
  execute function public.reno_project_start_date();

-- Existing projects: the start date where it is empty.
update public.projects p
   set start_date = to_char((coalesce(p.created_at::timestamptz, now()) at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD')
 where p.project_kind = 'renovation'
   and nullif(btrim(coalesce(p.start_date, '')), '') is null;

-- Closed as far as this SQL can tell: Closed set by hand (the last step: the data can never move past it), or
-- closed_at set while no hand-set step holds the project back. The engine's rule (flow.ts effectiveFlowStep): a
-- hand-set step stays in effect until the data moves past both it and the step the data was on when it was set.
with closed as (
  select p.id,
         coalesce(
           (select to_char((l.at at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD')
              from public.project_flow_log l
             where l.project_id = p.id and l.kind in ('manual_step', 'follow_data') and l.to_value = 'closed'
             order by l.at desc, l.id desc limit 1),
           case when p.flow_manual_step is null and p.closed_at is not null
                then to_char((p.closed_at at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD') end,
           to_char((coalesce(nullif(p.updated_at, '')::timestamptz, p.closed_at, nullif(p.created_at, '')::timestamptz, now())
                    at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD')
         ) as end_day
    from public.projects p
   where p.project_kind = 'renovation'
     and (p.flow_manual_step = 'closed'
          or (p.closed_at is not null
              and (p.flow_manual_step is null or coalesce(p.flow_manual_base_step, p.flow_manual_step) <> 'closed')))
)
update public.projects p
   set end_date = closed.end_day
  from closed
 where p.id = closed.id
   and p.end_date is distinct from closed.end_day;

-- Not closed and nothing that could close it: no end date.
update public.projects p
   set end_date = null
 where p.project_kind = 'renovation'
   and p.end_date is not null
   and p.flow_manual_step is distinct from 'closed'
   and p.closed_at is null
   and p.handed_over_at is null
   and not exists (select 1 from public.project_handovers h where h.project_id = p.id);
