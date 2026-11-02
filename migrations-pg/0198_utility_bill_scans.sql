-- REVERSAL: none needed; new tables and empty columns only. Scanned bills are ordinary expenses; to undo one, delete it
-- on the Utility bills screen (its open owner lines go with it).
-- Scanning utility bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 3; spec
-- docs/superpowers/specs/2026-10-27-utility-bills-design.md §5.3-5.4):
--   utility_account_marks  what each account's bills look like, learnt on every recorded scan (masked number, deposit,
--                          building, owner name, last meter reading), so next month's page matches by itself;
--   utility_bill_scans     one row per page read: what was read, by which model, the unit proposed, the colour, and the
--                          expense it became, whether the owner paid it and the bill as recorded (so the payment
--                          request to finance lists exactly what was recorded), for audit and the accuracy count;
--   expenses.period_from / period_to   the period printed on the bill (YYYY-MM-DD), which the split by contract days uses
--                          (FINANCE-SOP §3.10);
--   owner_adjustments.expense_id      the scanned bill an owner line came from (owner paid it: O2 back; days outside the
--                          contract: O2 charge), so deleting the bill takes its open lines with it.
-- Numbered 0198: 0197 (payment_request_source_key, engine) is the last on production and on every branch.
-- APPLY: by hand, in one transaction with its public.pos_migrations row.

set local search_path = pos, public;
set local lock_timeout = '5s';

create table if not exists pos.utility_account_marks (
  account_id text primary key references pos.unit_utility_accounts(id) on delete cascade,
  account_no_pattern text,
  deposit_sen integer,
  building_text text,
  owner_name text,
  last_meter_reading numeric,
  last_bill_month text,
  updated_at text not null
);

create table if not exists pos.utility_bill_scans (
  id text primary key,
  batch_id text not null,
  document_id text not null references pos.documents(id),
  model text not null,
  read jsonb not null,
  proposed_account_id text references pos.unit_utility_accounts(id) on delete set null,
  colour text not null check (colour in ('green', 'amber', 'red')),
  expense_id text references pos.expenses(id) on delete set null,
  owner_paid boolean not null default false,
  bill_sen integer,
  provider text,
  account_no text,
  created_by text not null,
  created_at text not null
);
create index if not exists utility_bill_scans_batch on pos.utility_bill_scans (batch_id);
create index if not exists utility_bill_scans_document on pos.utility_bill_scans (document_id);

alter table pos.expenses add column if not exists period_from text;
alter table pos.expenses add column if not exists period_to text;
alter table pos.owner_adjustments add column if not exists expense_id text references pos.expenses(id) on delete set null;
create index if not exists owner_adjustments_expense on pos.owner_adjustments (expense_id) where expense_id is not null;

grant select, insert, update, delete on pos.utility_account_marks to pos_app;
grant select, insert, update, delete on pos.utility_bill_scans to pos_app;
grant all on pos.utility_account_marks to service_role;
grant all on pos.utility_bill_scans to service_role;
