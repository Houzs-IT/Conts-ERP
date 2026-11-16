-- REVERSAL: drop view public.conts_renovators;
-- Renovation crew on the phone (Jobs tab): the engine must know which brand a signed-in renovator works under, so it
-- lists only that brand's projects. pos.renovators.brand_id (migration 0324) holds it; the engine's role (scm_engine)
-- reads nothing in schema pos, so this view, owned by the migration role, is the one thing it may read, as
-- public.conts_staff (migration 0113) is for staff. Only active renovators with a brand appear: user_id is the
-- Property OS user id, brand_name the name in public.project_brands. Read-only; nothing else in pos is exposed.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0331, dry run first.
-- The engine code treats a missing view as "not ready", so either side may deploy first.

create view public.conts_renovators as
  select r.user_id, b.name as brand_name
    from pos.renovators r
    join public.project_brands b on b.id = r.brand_id
   where r.is_active = 1 and r.user_id is not null;

revoke all on public.conts_renovators from public, anon, authenticated;
grant select on public.conts_renovators to scm_engine;
