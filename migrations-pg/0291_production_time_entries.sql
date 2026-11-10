-- REVERSAL: revert the code first; then drop table scm.production_time_entries. (btree_gist may stay; nothing else uses it.)
-- Worker actual hours on a production order (TODO item 16). A worker presses Start time / Stop time on the order, or a
-- supervisor adds or corrects an entry by hand. Actual hours = the sum of the entries; the budget stays
-- production_orders.production_time_hours (management's figure, migration 0237) and the plan dates stay plan_start /
-- expected_at. Nothing here changes those.
--
--   person_key   the worker, as production_order_workers keys them: a technician's id (Assign) or user:<id> (Start).
--   how          TIMER (Start time / Stop time) or MANUAL (typed by a supervisor).
--   stopped_at   null while the timer runs; at most one running timer per person per order (unique index).
--   no overlap   one person's entries on one order never overlap, a running one reaching to infinity: an exclusion
--                constraint (btree_gist for the uuid / text equality), so two supervisors saving at once cannot both win.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, staging first, then production, BEFORE the
-- code that needs it merges.
select demo.drop_views();
set local lock_timeout = '5s';

-- In the extensions schema, as 0044 put pg_trgm; the default operator classes are found from any schema.
create extension if not exists btree_gist with schema extensions;

create table if not exists scm.production_time_entries (
  id                   uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references scm.production_orders(id) on delete cascade,
  company_id           bigint not null references public.companies(id),
  person_key           text not null,
  name                 text not null,
  started_at           timestamptz not null,
  stopped_at           timestamptz,
  notes                text,
  how                  text not null default 'TIMER' check (how in ('TIMER', 'MANUAL')),
  created_at           timestamptz not null default now(),
  created_by           uuid references scm.staff(id) on delete set null,
  created_by_name      text,
  updated_at           timestamptz,
  updated_by_name      text,
  check (stopped_at is null or stopped_at > started_at),
  constraint production_time_entries_no_overlap exclude using gist (
    production_order_id with =,
    person_key with =,
    tstzrange(started_at, coalesce(stopped_at, 'infinity'::timestamptz), '[)') with &&
  )
);
create index if not exists production_time_entries_order_idx on scm.production_time_entries (production_order_id, started_at);
create unique index if not exists production_time_entries_one_running
  on scm.production_time_entries (production_order_id, person_key) where stopped_at is null;

alter table scm.production_time_entries owner to scm_engine;
alter table scm.production_time_entries enable row level security;
revoke all on scm.production_time_entries from anon, authenticated;
grant all on scm.production_time_entries to service_role, pos_app;

notify pgrst, 'reload schema';
select demo.sync();
