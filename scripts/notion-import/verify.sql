-- Counts of everything the Notion import wrote (source = 'import'), plus a fingerprint of the row versions
-- (xmin) of those rows. Run it before and after a re-run of the import: identical fingerprints prove that the
-- re-run wrote nothing (any UPDATE, even one that changes no value, gives a row a new xmin).
-- Read-only. Company 1.
with p as (select id from public.projects where company_id = 1 and source = 'import')
select json_build_object(
  'projects', (select count(*) from p),
  'projects_by_step', (select json_object_agg(flow_manual_step, n) from (select flow_manual_step, count(*) n from public.projects
                         where company_id = 1 and source = 'import' group by 1) s),
  'projects_in_defect', (select count(*) from public.projects where company_id = 1 and source = 'import' and hold_flag = 'in_defect'),
  'project_codes', (select min(code) || ' .. ' || max(code) from public.projects where company_id = 1 and source = 'import'),
  'people', (select count(*) from public.project_people where company_id = 1 and source = 'import'),
  'tasks', (select count(*) from public.project_trade_tasks where company_id = 1 and source = 'import'),
  'tasks_done', (select count(*) from public.project_trade_tasks where company_id = 1 and source = 'import' and state = 'done'),
  'task_assignees', (select count(*) from public.project_trade_task_assignees a join public.project_trade_tasks t on t.id = a.task_id
                       where t.company_id = 1 and t.source = 'import'),
  'site_measures', (select count(*) from public.project_design_records where company_id = 1 and source = 'import'),
  'design_files', (select count(*) from public.project_design_files where company_id = 1 and source = 'import'),
  'key_moves', (select count(*) from public.project_key_moves where company_id = 1 and source = 'import'),
  'flow_log', (select count(*) from public.project_flow_log where company_id = 1 and source = 'import'),
  'activity_notes', (select count(*) from public.project_activity where company_id = 1 and action = 'notion_import'),
  'project_stages', (select count(*) from public.project_stages where project_id in (select id from p)),
  'project_finance', (select count(*) from public.project_finance where project_id in (select id from p)),
  'checklist_items', (select count(*) from public.project_checklist where project_id in (select id from p)),
  'fingerprint', md5(concat_ws('|',
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.projects where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_people where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_trade_tasks where company_id = 1 and source = 'import'),
    (select string_agg(a.id || ':' || a.xmin::text, ',' order by a.id) from public.project_trade_task_assignees a
       join public.project_trade_tasks t on t.id = a.task_id where t.company_id = 1 and t.source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_design_records where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_design_files where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_key_moves where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_flow_log where company_id = 1 and source = 'import'),
    (select string_agg(id || ':' || xmin::text, ',' order by id) from public.project_activity where company_id = 1 and action = 'notion_import')))
) as notion_import;
