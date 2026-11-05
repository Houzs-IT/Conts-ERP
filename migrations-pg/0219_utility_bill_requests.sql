-- Utility bills and their payment requests (chew, 5 Nov 2026; SOP 3.10 "Utility bills 两张表", "手动录入也一样").
--   owner_paid          the owner paid the provider ("Owner paid this bill"): the bill is shared as usual and the full
--                       amount goes back to the owner as an O2 credit; no payment request. Set by Scan bills and now by
--                       the manual entry screens too (was kept only on utility_bill_scans).
--   payment_request_id  the engine payment request (scm.payment_requests.id) the bill went out on, and its number,
--   payment_request_no  so the Utility bills "By payment request" view can place the bill in the request's month and a
--                       bill already sent for payment is not replaced by a new entry.
alter table pos.expenses add column if not exists owner_paid boolean not null default false;
alter table pos.expenses add column if not exists payment_request_id text;
alter table pos.expenses add column if not exists payment_request_no text;
create index if not exists expenses_payment_request_idx on pos.expenses (payment_request_id) where payment_request_id is not null;

-- Scanned bills already recorded keep their tick.
update pos.expenses e set owner_paid = true
  from pos.utility_bill_scans s where s.expense_id = e.id and s.owner_paid and not e.owner_paid;
