-- REVERSAL: drop table scm.reno_contract_credits; drop table scm.reno_revenue_allocations;
--           alter table scm.reno_so_contracts drop column billed_before_golive_sen, drop column advance_account_code;
-- Renovation contracts in the ledger (finance, chew 30 Oct 2026; spec docs/superpowers/specs/2026-10-30-renovation-revenue-
-- einvoice-design.md 2.1, 2.2, 2.5, 7.1, 7.3; plan 2026-10-30-renovation-revenue-ledger.md Task 3). Each contract is posted
-- whole to its project's own customer account and advance sub-account (480-xxxx / 481-xxxx) at signing; invoices move the
-- advance to revenue by the waterfall; credit notes lower the contract.
--   scm.reno_so_contracts.advance_account_code      the project's advance sub-account (a child of 480-0000 or 481-0000),
--                                                   opened at conversion; seeded by finance for contracts signed earlier.
--   scm.reno_so_contracts.billed_before_golive_sen  what was invoiced in AutoCount before the ledger start: the waterfall
--                                                   treats it as already filled, and later invoices continue from there.
--   scm.reno_revenue_allocations                    what each event (invoice, credit note, the go-live opening) allocated to
--                                                   which line and revenue account, so the next event posts only the difference.
--   scm.reno_contract_credits                       credit notes that lower a renovation contract.
-- Numbered 0185: 0184 (renovation_revenue_ledger) is the last on production and on every branch.
-- APPLY: by hand, to production before the code merges, in one transaction with its public.pos_migrations row.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.reno_so_contracts add column if not exists advance_account_code text;
alter table scm.reno_so_contracts add column if not exists billed_before_golive_sen bigint not null default 0;

create table if not exists scm.reno_revenue_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null,
  so_doc_no text not null references scm.reno_so_contracts (so_doc_no),
  source_type text not null,
  source_doc_no text not null,
  line_key text not null,
  account_code text not null,
  amount_sen bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists reno_revenue_allocations_so_idx on scm.reno_revenue_allocations (so_doc_no);

alter table scm.reno_revenue_allocations owner to scm_engine;
alter table scm.reno_revenue_allocations enable row level security;
revoke all on scm.reno_revenue_allocations from anon, authenticated;
-- The engine reaches it through the Supabase REST client (service_role).
grant all on scm.reno_revenue_allocations to service_role, pos_app;

create table if not exists scm.reno_contract_credits (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null,
  so_doc_no text not null references scm.reno_so_contracts (so_doc_no),
  credit_note_id uuid references scm.acc_credit_notes (id),
  note_number text,
  amount_sen bigint not null check (amount_sen > 0),
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists reno_contract_credits_so_idx on scm.reno_contract_credits (so_doc_no);

alter table scm.reno_contract_credits owner to scm_engine;
alter table scm.reno_contract_credits enable row level security;
revoke all on scm.reno_contract_credits from anon, authenticated;
grant all on scm.reno_contract_credits to service_role, pos_app;

notify pgrst, 'reload schema';
