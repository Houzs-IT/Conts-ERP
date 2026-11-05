-- Read-only lookup of the payment requests utility bills went out on (chew, 5 Nov 2026; SOP 3.10 "Utility bills 两张表").
-- scm.payment_requests has row level security with no policy for pos_app, so Property OS reads no rows from it and the
-- Utility bills "By payment request" table would be empty. This function, run as its owner, gives pos_app only the
-- requests a bill in pos.expenses points at, and only their number, status, amount and date: no payee, bank details
-- or lines, and nothing can be changed through it.
create or replace function pos.utility_payment_requests()
returns table (id text, request_no text, status text, amount_sen bigint, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select r.id::text, r.request_no, r.status, r.amount_sen, r.created_at
  from scm.payment_requests r
  where r.id::text in (select e.payment_request_id from pos.expenses e where e.payment_request_id is not null)
$$;

revoke all on function pos.utility_payment_requests() from public;
grant execute on function pos.utility_payment_requests() to pos_app;
