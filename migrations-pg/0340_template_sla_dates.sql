-- REVERSAL: alter table scm.reno_doc_lines drop column if exists processing_after_days, drop column if exists delivery_after_days;
--           alter table scm.reno_beta_line_plans drop column if exists from_sla; alter table public.projects drop column if exists works_started_on;
-- Package template SLA (owner, 19 Nov 2026): each template line says how many days after the project starts its processing
-- date and its delivery date fall. The days travel with the line onto the quotation and the sales order. When the project
-- is started (its works start date, set by the Start project button), every sales order line that carries days gets its
-- processing and delivery date on the line plan, marked from_sla; a date typed by hand clears the mark, so moving the
-- start date again re-dates only the lines still on their SLA.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0340, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_doc_lines
  add column if not exists processing_after_days int,
  add column if not exists delivery_after_days int;
alter table scm.reno_doc_lines drop constraint if exists reno_doc_lines_sla_days_ck;
alter table scm.reno_doc_lines add constraint reno_doc_lines_sla_days_ck check (
  (processing_after_days is null or processing_after_days between 0 and 3650)
  and (delivery_after_days is null or delivery_after_days between 0 and 3650)
  and (processing_after_days is null or delivery_after_days is null or processing_after_days <= delivery_after_days));

alter table scm.reno_beta_line_plans add column if not exists from_sla boolean not null default false;

alter table public.projects add column if not exists works_started_on date;

notify pgrst, 'reload schema';
