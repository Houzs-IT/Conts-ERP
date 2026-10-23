-- REVERSAL: drop table public.project_beta_settings, public.project_design_file_reviews; alter table public.project_defects drop constraint project_defects_trade_check, drop column trade, drop column fixed_at, drop column fixed_by, drop column after_photo_r2_key, drop column redo_count;
-- Beta project workspace, bundle A (owner, 23 Oct 2026; plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md).
-- Staging-only screens read these; production gets the empty tables because every route that touches them answers 404
-- there (BETA_ENABLED is not set in wrangler.production.toml).
--
-- * project_defects gains the Beta repair loop: trade (who fixes it), fixed_at / fixed_by / after_photo_r2_key (marked
--   fixed, waiting for the check) and redo_count (sent back to fix). Open = fixed_at and closed_at null, "check it" =
--   fixed_at set, done = closed_at set. The existing snag close route keeps working unchanged.
-- * project_design_file_reviews: one row per design file for the dates around the customer: when it was sent, when the
--   answer is due, and the customer's approval (who, which day, note). The approved set of a kind is its newest
--   file with an approval date.
-- * project_beta_settings: days allowed for the 3D and the 2D design, one row per company (no row = 10 and 12).
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
set local search_path = public, extensions;

alter table public.project_defects
  add column trade text,
  add column fixed_at timestamptz,
  add column fixed_by bigint,
  add column after_photo_r2_key text,
  add column redo_count integer not null default 0;
alter table public.project_defects
  add constraint project_defects_trade_check check (
    trade is null or trade in ('carpenter', 'electrician', 'plumber', 'painter', 'plaster', 'hacking', 'aircon', 'tiler', 'other'));

create table public.project_design_file_reviews (
  file_id bigint primary key references public.project_design_files(id) on delete cascade,
  project_id bigint not null references public.projects(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  sent_on date,
  due_on date,
  sent_by bigint,
  approved_on date,
  approved_by_name text,
  approval_note text,
  approval_recorded_by bigint,
  updated_at timestamptz not null default now()
);
create index project_design_file_reviews_project_idx on public.project_design_file_reviews (project_id);

create table public.project_beta_settings (
  company_id bigint primary key references public.companies(id),
  design_3d_days integer not null default 10 check (design_3d_days between 1 and 365),
  design_2d_days integer not null default 12 check (design_2d_days between 1 and 365),
  updated_by bigint,
  updated_at timestamptz not null default now()
);

alter table public.project_design_file_reviews owner to scm_engine;
alter table public.project_beta_settings owner to scm_engine;
alter table public.project_design_file_reviews enable row level security;
alter table public.project_beta_settings enable row level security;
revoke all on public.project_design_file_reviews from anon, authenticated;
revoke all on public.project_beta_settings from anon, authenticated;
