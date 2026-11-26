-- 0381_reno_review_direct_pay: the Reno review moves from a Claim to Me to a Direct pay request. A payment request with a
-- line on a sub-department flagged reno_review (0379) waits as RENO_REVIEW until the reviewer sends it to finance (SUBMITTED)
-- or sends it back (REJECTED, with a reason; the asker changes it and sends it again, which comes back to review).
-- A claim needs no review: the receipts that were waiting are released to finance as HANDED_IN.
--   scm.payment_requests.status         gains RENO_REVIEW
--   scm.payment_requests.reno_reviewed_by / reno_reviewed_at   who sent it on, and when
--
-- REVERSAL: update scm.payment_requests set status = 'SUBMITTED' where status = 'RENO_REVIEW';
--   alter table scm.payment_requests drop constraint payment_requests_status_check, drop column reno_reviewed_by, drop column reno_reviewed_at;
--   alter table scm.payment_requests add constraint payment_requests_status_check check (status in ('SUBMITTED', 'PART_PAID', 'PAID', 'REJECTED', 'CLOSED', 'WITHDRAWN'));
--   (the receipts released here stay HANDED_IN)
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.payment_requests drop constraint if exists payment_requests_status_check;
alter table scm.payment_requests add constraint payment_requests_status_check
  check (status in ('SUBMITTED', 'RENO_REVIEW', 'PART_PAID', 'PAID', 'REJECTED', 'CLOSED', 'WITHDRAWN'));

alter table scm.payment_requests add column if not exists reno_reviewed_by text, add column if not exists reno_reviewed_at timestamptz;

update scm.staff_receipts set status = 'HANDED_IN' where status = 'RENO_REVIEW';
