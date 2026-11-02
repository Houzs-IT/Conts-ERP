-- REVERSAL: none needed; the column is empty for every request made by hand, and the index covers only filled rows.
-- Scanned utility bills (plan docs/superpowers/plans/2026-11-02-utility-bill-scan.md Task 2): the bills a scan records
-- for the company to pay go to finance as one payment request per provider. source_key ('utility:<scan>:<provider>')
-- names where a request came from, so the same scan sent twice (a retry, two clicks) is one request
-- (engine conts/utility-bill-routes.ts).
-- APPLY: by hand, in one transaction with its public.pos_migrations row.

set local search_path = scm, public;
set local lock_timeout = '5s';

alter table scm.payment_requests add column if not exists source_key text;
create unique index if not exists payment_requests_source_key on scm.payment_requests (company_id, source_key) where source_key is not null;
