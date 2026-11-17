-- Why a utility payment request came back (chew, 13 Nov 2026: change it and send it again; SOP 3.10). The Utility bills
-- screens show a request finance rejected with its reason and who rejected it, so its bills can be fixed on the month
-- screen and the request sent again. Same read-only lookup as migration 0220 (only the requests a bill points at, and
-- nothing can be changed through it), with those two columns added; the return type changes, so it is made again.
drop function if exists pos.utility_payment_requests();

create function pos.utility_payment_requests()
returns table (id text, request_no text, status text, amount_sen bigint, created_at timestamptz, reason text, decided_by text)
language sql stable security definer
set search_path = ''
as $$
  select r.id::text, r.request_no, r.status, r.amount_sen, r.created_at, r.reason, r.decided_by
  from scm.payment_requests r
  where r.id::text in (select e.payment_request_id from pos.expenses e where e.payment_request_id is not null)
$$;

revoke all on function pos.utility_payment_requests() from public;
grant execute on function pos.utility_payment_requests() to pos_app;
