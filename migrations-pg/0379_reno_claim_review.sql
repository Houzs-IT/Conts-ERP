-- 0379_reno_claim_review: a Direct Claim to Me with a line on a sub-department flagged for Reno review waits for that
-- review before it reaches finance. The claim is saved RENO_REVIEW; the reviewer (Property OS gates who) edits the lines
-- and sends it on (HANDED_IN), or sends it back (REJECTED, with a reason; the claimant replaces it as for any rejection).
--   scm.staff_receipts.status         gains RENO_REVIEW (not a charged status in 0363, so no owner recovery fires on it)
--   scm.staff_receipts.reno_reviewed_by / reno_reviewed_at   who sent it on, and when
--   scm.acc_sub_departments.reno_review   the flag; seeded on Renovation's The Conts and Dream Crafter
--
-- REVERSAL: update scm.staff_receipts set status = 'HANDED_IN' where status = 'RENO_REVIEW';
--   alter table scm.staff_receipts drop constraint staff_receipts_status_check, drop column reno_reviewed_by, drop column reno_reviewed_at;
--   alter table scm.staff_receipts add constraint staff_receipts_status_check check (status in ('HANDED_IN', 'CHECKED', 'TOPPED_UP', 'PAID_BACK', 'REJECTED', 'REPAID', 'WRITTEN_OFF', 'REPLACED'));
--   alter table scm.acc_sub_departments drop column reno_review;
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.staff_receipts drop constraint if exists staff_receipts_status_check;
alter table scm.staff_receipts add constraint staff_receipts_status_check
  check (status in ('HANDED_IN', 'RENO_REVIEW', 'CHECKED', 'TOPPED_UP', 'PAID_BACK', 'REJECTED', 'REPAID', 'WRITTEN_OFF', 'REPLACED'));

alter table scm.staff_receipts add column if not exists reno_reviewed_by text, add column if not exists reno_reviewed_at timestamptz;

alter table scm.acc_sub_departments add column if not exists reno_review boolean not null default false;

update scm.acc_sub_departments set reno_review = true
 where department = 'supply' and (fixed_key in ('theconts', 'dreamcrafter') or name ~* '\m(TC|DC)\M');
