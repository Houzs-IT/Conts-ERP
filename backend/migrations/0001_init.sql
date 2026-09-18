-- 0001_init.sql — Conts ERP: auth profiles, RBAC, settings, org chart.
-- Login itself is Supabase Auth (auth.users). Everything below is OUR data.
-- Applied by scripts/migrate.mjs. Never edit an applied migration; add a new one.
-- REVERSAL: drop schema app cascade;  (destroys all settings/RBAC data)

create schema if not exists app;
create extension if not exists pgcrypto;

-- ── Org structure ───────────────────────────────────────────────────────────
create table app.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  parent_id   uuid references app.departments(id) on delete set null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint departments_not_self_parent check (parent_id is null or parent_id <> id)
);
create index departments_parent_idx on app.departments(parent_id);

create table app.positions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  department_id uuid references app.departments(id) on delete set null,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per signed-up user. id = auth.users.id, so a deleted login deletes the profile.
create table app.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  staff_code    text unique,
  full_name     text not null,
  email         text not null,
  phone         text,
  department_id uuid references app.departments(id) on delete set null,
  position_id   uuid references app.positions(id)   on delete set null,
  reports_to    uuid references app.profiles(id)    on delete set null,
  photo_path    text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_not_self_manager check (reports_to is null or reports_to <> id)
);
create index profiles_department_idx on app.profiles(department_id);
create index profiles_reports_to_idx on app.profiles(reports_to);
create unique index profiles_email_lower_idx on app.profiles(lower(email));

-- ── RBAC ────────────────────────────────────────────────────────────────────
create table app.roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_system   boolean not null default false,   -- system roles cannot be deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table app.permissions (
  code        text primary key,
  module      text not null,
  description text not null
);

create table app.role_permissions (
  role_id         uuid not null references app.roles(id) on delete cascade,
  permission_code text not null references app.permissions(code) on delete cascade,
  primary key (role_id, permission_code)
);

create table app.user_roles (
  user_id    uuid not null references app.profiles(id) on delete cascade,
  role_id    uuid not null references app.roles(id) on delete cascade,
  granted_by uuid references app.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- Menu pages a role may open. The UI reads this; the backend still checks permissions.
create table app.pages (
  key        text primary key,
  label      text not null,
  path       text not null,
  module     text not null,
  sort_order int  not null default 0
);

create table app.role_pages (
  role_id  uuid not null references app.roles(id) on delete cascade,
  page_key text not null references app.pages(key) on delete cascade,
  primary key (role_id, page_key)
);

-- ── Settings ────────────────────────────────────────────────────────────────
-- Single company (id is always true, so only one row can exist).
create table app.company_settings (
  id              boolean primary key default true check (id),
  name            text not null default 'The Conts',
  legal_name      text,
  registration_no text,
  address_line1   text,
  address_line2   text,
  postcode        text,
  city            text,
  state           text,
  country         text not null default 'Malaysia',
  phone           text,
  email           text,
  website         text,
  logo_path       text,
  timezone        text not null default 'Asia/Kuala_Lumpur',
  currency        text not null default 'MYR',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references app.profiles(id) on delete set null
);

create table app.doc_number_rules (
  doc_type      text primary key,
  prefix        text not null,
  padding       int  not null default 5,
  next_number   bigint not null default 1,
  reset_period  text not null default 'never' check (reset_period in ('never','yearly','monthly')),
  last_reset_key text,
  updated_at    timestamptz not null default now()
);

-- Invites issued from the UI; the login itself is created by Supabase Auth.
create table app.invitations (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text,
  role_id       uuid references app.roles(id) on delete set null,
  department_id uuid references app.departments(id) on delete set null,
  position_id   uuid references app.positions(id) on delete set null,
  invited_by    uuid references app.profiles(id) on delete set null,
  auth_user_id  uuid,
  status        text not null default 'pending' check (status in ('pending','accepted','revoked')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);
create unique index invitations_pending_email_idx on app.invitations(lower(email)) where status = 'pending';

-- Who changed what, when. Written by the backend on every write.
create table app.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references app.profiles(id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  ip         text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on app.audit_log(created_at desc);
create index audit_log_entity_idx  on app.audit_log(entity, entity_id);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger departments_touch before update on app.departments for each row execute function app.touch_updated_at();
create trigger positions_touch   before update on app.positions   for each row execute function app.touch_updated_at();
create trigger profiles_touch    before update on app.profiles    for each row execute function app.touch_updated_at();
create trigger roles_touch       before update on app.roles       for each row execute function app.touch_updated_at();

-- Every permission a user holds, through any role.
create or replace function app.user_permissions(p_user uuid)
returns table (code text) language sql stable as $$
  select distinct rp.permission_code
  from app.user_roles ur
  join app.role_permissions rp on rp.role_id = ur.role_id
  where ur.user_id = p_user
$$;

-- ── Lock the data down ──────────────────────────────────────────────────────
-- RLS on, with NO policies: browsers holding the anon key see nothing at all.
-- Only the Worker's service-role connection reaches these tables, and it checks
-- permissions on every route.
alter table app.departments      enable row level security;
alter table app.positions        enable row level security;
alter table app.profiles         enable row level security;
alter table app.roles            enable row level security;
alter table app.permissions      enable row level security;
alter table app.role_permissions enable row level security;
alter table app.user_roles       enable row level security;
alter table app.pages            enable row level security;
alter table app.role_pages       enable row level security;
alter table app.company_settings enable row level security;
alter table app.doc_number_rules enable row level security;
alter table app.invitations      enable row level security;
alter table app.audit_log        enable row level security;

revoke all on schema app from anon, authenticated;
revoke all on all tables in schema app from anon, authenticated;
revoke all on all functions in schema app from anon, authenticated;

-- ── Seed: permissions ───────────────────────────────────────────────────────
insert into app.permissions (code, module, description) values
  ('settings.company.view',      'settings', 'View company profile'),
  ('settings.company.edit',      'settings', 'Edit company profile'),
  ('settings.users.view',        'settings', 'View users'),
  ('settings.users.create',      'settings', 'Invite new users'),
  ('settings.users.edit',        'settings', 'Edit user details'),
  ('settings.users.deactivate',  'settings', 'Deactivate or reactivate users'),
  ('settings.roles.view',        'settings', 'View roles and permissions'),
  ('settings.roles.manage',      'settings', 'Create, edit and assign roles'),
  ('settings.departments.view',  'settings', 'View departments'),
  ('settings.departments.manage','settings', 'Create and edit departments'),
  ('settings.positions.view',    'settings', 'View positions'),
  ('settings.positions.manage',  'settings', 'Create and edit positions'),
  ('settings.docnumbers.view',   'settings', 'View document numbering'),
  ('settings.docnumbers.manage', 'settings', 'Edit document numbering'),
  ('settings.audit.view',        'settings', 'View the audit log'),
  ('orgchart.view',              'orgchart', 'View the organisation chart')
on conflict (code) do nothing;

-- ── Seed: pages ─────────────────────────────────────────────────────────────
insert into app.pages (key, label, path, module, sort_order) values
  ('settings.company',     'Company profile',   '/settings/company',     'settings', 10),
  ('settings.users',       'Users',             '/settings/users',       'settings', 20),
  ('settings.roles',       'Roles & access',    '/settings/roles',       'settings', 30),
  ('settings.departments', 'Departments',       '/settings/departments', 'settings', 40),
  ('settings.positions',   'Positions',         '/settings/positions',   'settings', 50),
  ('settings.docnumbers',  'Document numbers',  '/settings/doc-numbers', 'settings', 60),
  ('settings.audit',       'Audit log',         '/settings/audit',       'settings', 70),
  ('orgchart',             'Organisation chart','/org-chart',            'orgchart', 80)
on conflict (key) do nothing;

-- ── Seed: roles ─────────────────────────────────────────────────────────────
insert into app.roles (code, name, description, is_system) values
  ('owner',   'Owner',   'Full access to everything, including roles', true),
  ('admin',   'Admin',   'Manages users, departments and settings',    true),
  ('manager', 'Manager', 'Views people and settings, edits nothing',   true),
  ('staff',   'Staff',   'Sees the organisation chart only',           true)
on conflict (code) do nothing;

-- Owner: everything.
insert into app.role_permissions (role_id, permission_code)
select r.id, p.code from app.roles r cross join app.permissions p where r.code = 'owner'
on conflict do nothing;

-- Admin: everything except managing roles.
insert into app.role_permissions (role_id, permission_code)
select r.id, p.code from app.roles r cross join app.permissions p
where r.code = 'admin' and p.code <> 'settings.roles.manage'
on conflict do nothing;

-- Manager: read-only.
insert into app.role_permissions (role_id, permission_code)
select r.id, p.code from app.roles r cross join app.permissions p
where r.code = 'manager' and (p.code like '%.view' or p.code = 'orgchart.view')
on conflict do nothing;

-- Staff: org chart only.
insert into app.role_permissions (role_id, permission_code)
select r.id, 'orgchart.view' from app.roles r where r.code = 'staff'
on conflict do nothing;

-- Pages each role may open.
insert into app.role_pages (role_id, page_key)
select r.id, pg.key from app.roles r cross join app.pages pg where r.code in ('owner','admin')
on conflict do nothing;

insert into app.role_pages (role_id, page_key)
select r.id, pg.key from app.roles r cross join app.pages pg
where r.code = 'manager' and pg.key <> 'settings.audit'
on conflict do nothing;

insert into app.role_pages (role_id, page_key)
select r.id, 'orgchart' from app.roles r where r.code = 'staff'
on conflict do nothing;

-- ── Seed: the single company row ────────────────────────────────────────────
insert into app.company_settings (id) values (true) on conflict (id) do nothing;
