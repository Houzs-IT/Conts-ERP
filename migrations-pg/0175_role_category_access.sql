-- REVERSAL: drop table public.role_category_access;
-- Role access by product category (Renovation beta project screens, plan PLAN-category-rbac.md, phase 1).
-- A role with no rows here sees every category, so applying this changes nothing until management ticks boxes on
-- Roles. A role with rows sees only the ticked groups and sub-categories: sub_code null means the whole group,
-- group_code 'OTHER' means products with no category. No foreign key to the scm category tables (the 'OTHER'
-- sentinel would break it); the roles route checks the codes against the catalog.
set local search_path = public, extensions;

create table public.role_category_access (
  role_id    bigint not null references public.roles(id) on delete cascade,
  group_code text   not null,
  sub_code   text,
  updated_by bigint,
  updated_at timestamptz not null default now()
);
create unique index role_category_access_uq on public.role_category_access (role_id, group_code, coalesce(sub_code, ''));

alter table public.role_category_access owner to scm_engine;
alter table public.role_category_access enable row level security;
revoke all on public.role_category_access from anon, authenticated;
grant all on public.role_category_access to service_role;
