-- Repair jobs in the building, not in a unit (CONTS-0020, FONG, 10 Nov 2026): the phone Report a problem sheet gets an
-- "Others" choice for the lobby, lift or corridor. The job is saved against the building and the company pays, never an owner.
--
--   maintenance_issues.unit_id       becomes nullable.
--   maintenance_issues.property_id   the building, filled only on a job with no unit. Exactly one of the two is set, and a
--                                    building job is charged to the_conts with no owner approval and no unit block.
--
-- The code reads property_id only when it exists (hasColumn), so it can ship before this is applied.
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- REVERSAL: delete from maintenance_issues where unit_id is null; alter table maintenance_issues drop constraint if exists maintenance_issues_unit_or_building, drop column property_id, alter column unit_id set not null; delete from demo.maintenance_issues where unit_id is null; alter table demo.maintenance_issues alter column unit_id set not null; select demo.sync();
set local search_path = pos;
set local lock_timeout = '5s';

alter table maintenance_issues alter column unit_id drop not null;
alter table maintenance_issues add column if not exists property_id text references properties(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_issues_unit_or_building') then
    alter table maintenance_issues add constraint maintenance_issues_unit_or_building check (
      (unit_id is not null and property_id is null)
      or (unit_id is null and property_id is not null and charge_to = 'the_conts'
          and owner_approval_required = 0 and blocks_unit = 0));
  end if;
end $$;
create index if not exists maintenance_issues_property_idx on maintenance_issues(property_id) where property_id is not null;

do $$ begin
  if to_regclass('demo.maintenance_issues') is not null then
    alter table demo.maintenance_issues alter column unit_id drop not null;
  end if;
end $$;

select demo.sync();
