-- REVERSAL: drop trigger if exists reno_templates_package_sync on scm.reno_quotation_templates; drop function if exists scm.reno_templates_package_sync();
--   drop index if exists scm.uq_reno_templates_company_code; drop index if exists scm.idx_reno_doc_lines_from_package;
--   alter table scm.reno_doc_lines drop column if exists from_package_id;
--   alter table scm.reno_quotation_templates drop column if exists code, drop column if exists kind, drop column if exists building,
--     drop column if exists unit_type, drop column if exists sales_note, drop column if exists status;
-- Packages module (owner, 20 Nov 2026). A package template becomes one record of the Packages module, of two kinds:
-- a Package (PKG-, a whole unit, grouped by area) and a Kit (KIT-, a few items, usually no area). Each has a code unique in
-- its company, an optional building, unit type and note for sales, and a status: Draft, Active or Inactive. Only an Active
-- one is offered in the sales order / variation order search; Draft and Inactive never are.
--  * status and the old active flag are kept in step by a trigger, so the old template screens and the old From template
--    picker (which read active) keep working: active = (status = 'ACTIVE'); a write that changes only active sets status.
--  * code: every existing template gets PKG-001, PKG-002 ... (per company, oldest first, after any PKG-<n> already used);
--    a template inserted without a code (the old New template button, Save quotation as template) gets the next one.
--  * Existing templates become Packages; an archived one (active = false) becomes Inactive, the rest Active.
--  * reno_doc_lines.from_package_id: the package a line was added from (a variation order line, and the sales order line it
--    becomes on approval). Screen only: nothing printed reads it. A deleted package leaves the lines, without the mark.
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0347, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_quotation_templates
  add column if not exists code text,
  add column if not exists kind text not null default 'PACKAGE',
  add column if not exists building text not null default '',
  add column if not exists unit_type text not null default '',
  add column if not exists sales_note text not null default '',
  add column if not exists status text not null default 'ACTIVE';

alter table scm.reno_quotation_templates drop constraint if exists reno_quotation_templates_kind_ck;
alter table scm.reno_quotation_templates add constraint reno_quotation_templates_kind_ck check (kind in ('PACKAGE', 'KIT'));
alter table scm.reno_quotation_templates drop constraint if exists reno_quotation_templates_status_ck;
alter table scm.reno_quotation_templates add constraint reno_quotation_templates_status_ck check (status in ('DRAFT', 'ACTIVE', 'INACTIVE'));

-- Archived templates are Inactive. Only rows still out of step: a re-run changes nothing.
update scm.reno_quotation_templates set status = 'INACTIVE' where not active and status = 'ACTIVE';

-- Codes for the templates that have none.
with mx as (
  select company_id, coalesce(max(substring(code from '^PKG-([0-9]+)$')::int), 0) as n
    from scm.reno_quotation_templates group by company_id
), todo as (
  select id, company_id, row_number() over (partition by company_id order by created_at, id) as rn
    from scm.reno_quotation_templates where code is null
)
update scm.reno_quotation_templates t
   set code = 'PKG-' || lpad((mx.n + todo.rn)::text, 3, '0')
  from todo join mx on mx.company_id = todo.company_id
 where t.id = todo.id;

create unique index if not exists uq_reno_templates_company_code on scm.reno_quotation_templates (company_id, upper(code));

create or replace function scm.reno_templates_package_sync() returns trigger
language plpgsql as $$
declare n int;
begin
  if new.code is null or btrim(new.code) = '' then
    select coalesce(max(substring(code from '^' || p.pfx || '([0-9]+)$')::int), 0) + 1 into n
      from (select case when new.kind = 'KIT' then 'KIT-' else 'PKG-' end as pfx) p
      left join scm.reno_quotation_templates t on t.company_id = new.company_id and t.code like p.pfx || '%';
    new.code := (case when new.kind = 'KIT' then 'KIT-' else 'PKG-' end) || lpad(n::text, 3, '0');
  end if;
  new.code := upper(btrim(new.code));
  if tg_op = 'INSERT' then
    if new.status is distinct from 'ACTIVE' then new.active := (new.status = 'ACTIVE');
    elsif not new.active then new.status := 'INACTIVE';
    end if;
  elsif new.status is distinct from old.status then
    new.active := (new.status = 'ACTIVE');
  elsif new.active is distinct from old.active then
    new.status := case when new.active then 'ACTIVE' else 'INACTIVE' end;
  end if;
  return new;
end $$;

drop trigger if exists reno_templates_package_sync on scm.reno_quotation_templates;
create trigger reno_templates_package_sync before insert or update on scm.reno_quotation_templates
  for each row execute function scm.reno_templates_package_sync();

alter table scm.reno_quotation_templates alter column code set not null;

alter table scm.reno_doc_lines
  add column if not exists from_package_id uuid references scm.reno_quotation_templates(id) on delete set null;
create index if not exists idx_reno_doc_lines_from_package on scm.reno_doc_lines (from_package_id) where from_package_id is not null;

notify pgrst, 'reload schema';
