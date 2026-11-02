-- REVERSAL: drop table if exists scm.job_progress; alter table scm.delivery_orders drop column if exists pod_photo_keys;
--   alter table scm.doc_attachments drop constraint doc_attachments_source_check, add constraint doc_attachments_source_check
--   check (source in ('upload', 'import', 'legacy')) (after the 'pod' rows are set back to 'upload').
--   Revert the code first (engine/backend/src/scm/routes/delivery-job-progress.ts reads and writes both).
-- CONTS-0008 (Lim Wei Siang, 31 Oct 2026): the supply chain follows Houzs's proof of delivery. Houzs migration
-- 20261016T0459_scm_job_progress, the same table and column:
--   scm.job_progress              one row per job leg that is not a delivery order (a DP job, a project setup or
--                                 dismantle, a service case leg): when the crew left, arrived and finished, and the
--                                 POD photos, note and location. A delivery order keeps its POD on its own row.
--   scm.delivery_orders           pod_photo_keys, every POD photo of a delivery (pod_r2_key keeps the first, for every
--                                 reader that already uses it).
--   scm.doc_attachments           source 'pod': a goods receipt's proof-of-receipt photos (the goods as they arrived,
--                                 the supplier's signed delivery order), shown on the GR's Proof of receipt card.
-- One empty table and one column with a constant default (metadata-only); no existing value is rewritten.
-- Numbered 0193: 0192 (reno_expected_cost_review) is the last on production.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table if not exists scm.job_progress (
  id               uuid primary key default gen_random_uuid(),
  company_id       bigint,
  source_type      text not null check (source_type in ('dp', 'project', 'assr')),
  source_id        text not null,
  leg              text not null,
  trip_id          uuid,
  departed_at      timestamptz,
  departed_by      bigint,
  arrived_at       timestamptz,
  arrived_by       bigint,
  completed_at     timestamptz,
  completed_by     bigint,
  pod_photo_keys   jsonb not null default '[]'::jsonb,
  pod_notes        text,
  pod_lat          double precision,
  pod_lng          double precision,
  pod_accuracy_m   double precision,
  pod_located_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint job_progress_one_row_per_leg unique (source_type, source_id, leg)
);
create index if not exists idx_job_progress_trip on scm.job_progress (trip_id);
create index if not exists idx_job_progress_completed on scm.job_progress (completed_at);
alter table scm.job_progress owner to scm_engine;
alter table scm.job_progress enable row level security;
revoke all on scm.job_progress from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.job_progress to service_role, pos_app;

alter table scm.delivery_orders add column if not exists pod_photo_keys jsonb not null default '[]'::jsonb;

alter table scm.doc_attachments drop constraint if exists doc_attachments_source_check;
alter table scm.doc_attachments add constraint doc_attachments_source_check check (source in ('upload', 'import', 'legacy', 'pod'));

notify pgrst, 'reload schema';
