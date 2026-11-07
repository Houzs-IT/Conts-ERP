-- REVERSAL: alter table scm.reno_doc_instalments drop constraint reno_doc_instalments_pct_bp_check, add constraint reno_doc_instalments_pct_bp_check check (pct_bp > 0 and pct_bp <= 10000);
-- A VO after the last instalment had nothing to bill on. The contract now gets one more instalment for the balance, at 0%,
-- because its percentage adds nothing: as the last row it bills whatever the contract still has to bill.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.reno_doc_instalments drop constraint reno_doc_instalments_pct_bp_check;
alter table scm.reno_doc_instalments add constraint reno_doc_instalments_pct_bp_check check (pct_bp >= 0 and pct_bp <= 10000);

select demo.sync();
