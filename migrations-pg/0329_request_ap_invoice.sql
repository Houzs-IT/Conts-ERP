-- REVERSAL: drop index scm.ap_invoices_payment_request_live; alter table scm.ap_invoices drop column payment_request_id, drop column provisional;
--   alter table scm.ap_invoice_lines drop column unit_id, drop column source_request_line_id;
--   alter table scm.payment_requests drop column ap_invoice_id, drop column ap_paid_before_sen, drop column parent_request_id, drop column asked_lines, drop column asked_amount_sen;
-- A payment request becomes an AP invoice, a quotation is booked first, and the balance is asked from the deposit
-- request (chew, 15 Nov 2026; design docs/superpowers/specs/2026-11-15-request-to-ap-invoice-design.md).
--   scm.payment_requests.ap_invoice_id        the bill the request is paid through (a deposit and its balance share one)
--   scm.payment_requests.ap_paid_before_sen   what that bill had paid when the request was linked
--   scm.payment_requests.parent_request_id    a balance request's deposit request
--   scm.payment_requests.asked_lines / asked_amount_sen   the request as first asked, kept once the bill changes it
--   scm.ap_invoices.payment_request_id        the request the bill was made from: one live bill per request
--   scm.ap_invoices.provisional               a quotation booked before the formal invoice (SOP 3.8)
--   scm.ap_invoice_lines.unit_id / source_request_line_id   the unit, and the request line the bill line came from
-- The tables' grants cover the new columns.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0329, dry run first,
-- before the code merges (the engine reads and writes these columns).
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.ap_invoices
  add column if not exists payment_request_id uuid references scm.payment_requests(id),
  add column if not exists provisional boolean not null default false;
-- One live bill per request: two clicks on Make AP invoice cannot raise two.
create unique index if not exists ap_invoices_payment_request_live on scm.ap_invoices (payment_request_id)
  where payment_request_id is not null and status <> 'CANCELLED';

alter table scm.ap_invoice_lines
  add column if not exists unit_id text,
  add column if not exists source_request_line_id uuid;

alter table scm.payment_requests
  add column if not exists ap_invoice_id uuid references scm.ap_invoices(id),
  add column if not exists ap_paid_before_sen bigint not null default 0,
  add column if not exists parent_request_id uuid references scm.payment_requests(id),
  add column if not exists asked_lines jsonb,
  add column if not exists asked_amount_sen bigint;
create index if not exists payment_requests_ap_invoice on scm.payment_requests (ap_invoice_id) where ap_invoice_id is not null;
create index if not exists payment_requests_parent on scm.payment_requests (parent_request_id) where parent_request_id is not null;

notify pgrst, 'reload schema';
