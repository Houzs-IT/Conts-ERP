-- REVERSAL: alter table public.project_beta_events drop column person_ids; alter table public.project_beta_appointments drop column person_ids;
-- Owner, 22 Nov 2026: a booking (Add work, Book appointment) can go to several people, and it shows on each one's own
-- calendar. The people are kept as an array, as project_beta_design keeps the 3D / 2D people (migration 0148);
-- person_id stays as the first pick so code from before this change still reads one name.
-- Backfill: every row with a person gets that one person in the list. Production on 22 Nov 2026: 0 events, 4
-- appointments of which 3 have a person.
-- Required by the code: the board reads person_ids, so apply this to production before merging the code that reads it.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0362, dry run first.

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.project_beta_events add column if not exists person_ids bigint[] not null default '{}';
alter table public.project_beta_appointments add column if not exists person_ids bigint[] not null default '{}';

update public.project_beta_events set person_ids = array[person_id] where person_id is not null and person_ids = '{}';
update public.project_beta_appointments set person_ids = array[person_id] where person_id is not null and person_ids = '{}';

create index if not exists project_beta_events_person_ids_idx on public.project_beta_events using gin (person_ids);
