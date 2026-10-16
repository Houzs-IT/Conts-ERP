-- REVERSAL: none needed (data only). To put the import day back: update public.projects set start_date = to_char((created_at::timestamptz at time zone 'Asia/Kuala_Lumpur')::date, 'YYYY-MM-DD') where project_kind = 'renovation' and source = 'import';
-- Projects imported from Notion show their real start, not the import day (owner, 16 Oct 2026: every imported card
-- said "Started 2026/10/11"). Migration 0117 filled start_date with the day the row was created, which for the 96
-- imported projects is the day of the import. Their real start is the earliest date the import brought with it:
--   * the Notion SO date (kept in the project's 'notion_import' activity note, "SO date: YYYY-MM-DD"),
--   * the earliest design record (site measure) or design file (uploaded / submitted),
--   * the earliest planned or actual start of a site task,
--   * the handover day.
-- Only imported renovation projects are touched, and a start date only ever moves earlier (nobody types it, migration
-- 0117). Safe to run again: scripts/notion-import/sql.mjs runs the same statement after its activity notes.
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

with first_seen as (
  select p.id,
         to_char(least(
           (select min(substring(a.note from 'SO date: ([0-9]{4}-[0-9]{2}-[0-9]{2})')::date)
              from public.project_activity a where a.project_id = p.id and a.action = 'notion_import'),
           (select min(d.done_on) from public.project_design_records d where d.project_id = p.id),
           (select min(least(coalesce(f.submitted_on, (f.uploaded_at at time zone 'Asia/Kuala_Lumpur')::date),
                             (f.uploaded_at at time zone 'Asia/Kuala_Lumpur')::date))
              from public.project_design_files f where f.project_id = p.id),
           (select min(least(coalesce(t.planned_start, t.actual_start), coalesce(t.actual_start, t.planned_start)))
              from public.project_trade_tasks t where t.project_id = p.id),
           (p.handed_over_at at time zone 'Asia/Kuala_Lumpur')::date
         ), 'YYYY-MM-DD') as day
    from public.projects p
   where p.project_kind = 'renovation'
     and p.source = 'import'
)
update public.projects p
   set start_date = first_seen.day
  from first_seen
 where p.id = first_seen.id
   and first_seen.day is not null
   and first_seen.day < p.start_date;
