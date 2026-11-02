-- REVERSAL: drop table scm.reno_cost_alerts; drop table scm.reno_expected_cost_changes;
--           alter table scm.acc_company_settings drop column reno_alert_min_sen, drop column reno_alert_pct_bp,
--             drop column reno_alert_hod_notify, drop column reno_alert_hod_emails;
-- The renovation expected-cost review (finance, chew 2 Nov 2026; SOP 4.2.1 实际和预计有差; plan
-- docs/superpowers/plans/2026-11-02-renovation-expected-cost-review.md Task 1).
--   scm.reno_expected_cost_changes  every change finance or HOD made to a contract's expected total cost. The
--                                   completion % (acc/reno-completion) adds adjustment_sen to the lines' cost from
--                                   effective_on, so an earlier month never moves and a later VO still adds.
--   scm.reno_cost_alerts            what the 30-minute sweep (acc/reno-cost-alerts) found: a contract line whose
--                                   purchase orders run over or under its cost, or a project whose cost spent and
--                                   ordered runs over the expected cost. One OPEN row per line or project; finance
--                                   answers it by a change (CHANGED) or by keeping the estimate (KEPT).
--   acc_company_settings            the threshold (RM 500 or 5%, the larger) and the HOD email, off by default.
-- Numbered 0192: 0191 (line_plans_grants) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table if not exists scm.reno_expected_cost_changes (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null,
  so_doc_no text not null,
  effective_on date not null,
  old_expected_sen bigint not null,
  new_expected_sen bigint not null,
  adjustment_sen bigint not null,
  reason text not null check (length(trim(reason)) > 0),
  changed_by bigint,
  changed_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists reno_expected_cost_changes_doc on scm.reno_expected_cost_changes (company_id, so_doc_no, effective_on);
-- Two saves of the same change at once (two people, a retry) would add the adjustment twice: the second is refused.
create unique index if not exists reno_expected_cost_changes_once
  on scm.reno_expected_cost_changes (company_id, so_doc_no, effective_on, old_expected_sen, new_expected_sen);
alter table scm.reno_expected_cost_changes owner to scm_engine;
alter table scm.reno_expected_cost_changes enable row level security;
revoke all on scm.reno_expected_cost_changes from anon, authenticated;
grant all on scm.reno_expected_cost_changes to service_role, pos_app;

create table if not exists scm.reno_cost_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null,
  so_doc_no text not null,
  kind text not null check (kind in ('LINE_OVER', 'LINE_UNDER', 'PROJECT_OVER')),
  so_item_id text,
  budget_sen bigint not null,
  committed_sen bigint not null,
  gap_sen bigint not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CHANGED', 'KEPT', 'CLEARED')),
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by bigint,
  resolved_by_name text,
  note text,
  change_id uuid references scm.reno_expected_cost_changes (id),
  hod_notified_at timestamptz
);
create unique index if not exists reno_cost_alerts_one_open
  on scm.reno_cost_alerts (company_id, so_doc_no, kind, coalesce(so_item_id, '')) where status = 'OPEN';
create index if not exists reno_cost_alerts_status on scm.reno_cost_alerts (company_id, status);
alter table scm.reno_cost_alerts owner to scm_engine;
alter table scm.reno_cost_alerts enable row level security;
revoke all on scm.reno_cost_alerts from anon, authenticated;
grant all on scm.reno_cost_alerts to service_role, pos_app;

alter table scm.acc_company_settings
  add column if not exists reno_alert_min_sen bigint not null default 50000,
  add column if not exists reno_alert_pct_bp integer not null default 500,
  add column if not exists reno_alert_hod_notify boolean not null default false,
  add column if not exists reno_alert_hod_emails text not null default '';

notify pgrst, 'reload schema';
