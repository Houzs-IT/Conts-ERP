-- REVERSAL: drop table if exists public.ai_usage_events;
-- One row per Anthropic call the engine makes (Houzs 20261016T0920_ai_usage_events.sql, #4700; TODO item 19): the bill
-- reader on Scan bills (payment vouchers, AP invoices), the receipt read on My claims, the bill read on a Direct pay
-- request, and the utility bill read. Written by engine/backend/src/services/aiUsage.ts right after each fetch, read by
-- the engine's AI usage screen (Finance > Reports, GET /api/scm/accounting/ai-usage). Additive: the recorder swallows a
-- failed insert, so the engine keeps reading bills with this table absent; the screen then shows nothing recorded.
--   feature      bill_extract, claim_receipt, request_bill, utility_bill_read
--   company_id   the caller's active company (public.companies.id), null when not known
--   user_id      the engine user behind the call when known (claims forwarded from Property OS: null)
--   *_tokens     straight from the Anthropic response's usage block
--   ok           false on an HTTP error, an error body or a network failure; error / http_status say which
-- APPLY: by hand, in one transaction with its public.pos_migrations row.
select demo.drop_views();
set local search_path = public, extensions;
set local lock_timeout = '5s';

create table if not exists public.ai_usage_events (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  feature            text        not null,
  company_id         bigint      null,
  user_id            integer     null,
  model              text        not null,
  input_tokens       integer     not null default 0,
  output_tokens      integer     not null default 0,
  cache_read_tokens  integer     not null default 0,
  cache_write_tokens integer     not null default 0,
  ok                 boolean     not null,
  error              text        null,
  http_status        integer     null
);

create index if not exists idx_ai_usage_events_company_created_at on public.ai_usage_events (company_id, created_at);
create index if not exists idx_ai_usage_events_feature_created_at on public.ai_usage_events (feature, created_at);
-- The bill-read limit (pv-extract.ts): one count per read of this company's, this feature's, this person's last minutes.
create index if not exists idx_ai_usage_events_limit on public.ai_usage_events (company_id, feature, user_id, created_at);

comment on table public.ai_usage_events is
  'One row per Anthropic API call by the engine (tokens, ok/error). Written by services/aiUsage.ts, read by the AI usage screen.';

-- The engine owns its tables (0047) and is the only reader and writer (as 0080): the browser-facing roles and Property OS
-- (pos_app) get nothing.
alter table public.ai_usage_events owner to scm_engine;
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant select, insert on public.ai_usage_events to service_role;

notify pgrst, 'reload schema';

select demo.sync();
