-- REVERSAL: alter table public.project_beta_events drop column who_text; alter table public.project_beta_appointments drop column who_text;
-- Owner, 20 Nov 2026: who goes to a booking is picked from the company's people, typed in, or left empty. A typed name
-- (someone with no account, a contractor) is kept here; person_id stays the link to a person, whose own calendar shows it.
-- Required by the code: the board reads both columns, so apply this to production before merging the code that reads it.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0349, dry run first.

set local search_path = public, extensions;
set local lock_timeout = '5s';

alter table public.project_beta_events add column if not exists who_text text;
alter table public.project_beta_appointments add column if not exists who_text text;
