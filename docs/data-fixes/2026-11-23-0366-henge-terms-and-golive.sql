-- APPLIED to production on 23 Nov 2026 as migration 0366 (migrate-production.yml, --only=0366). Kept here, not in
-- migrations-pg: it is a one-off fix of one production contract; public.pos_migrations keeps its row.

-- 0366_henge_terms_and_golive: one-off data fix of one production contract, THE HENGE E18-01 (TC-SO-2505-001),
-- chew 23 Nov 2026. On an empty database (CI, staging) the row is not there and nothing changes.
--
-- 1. Its go-live amount (reno_so_contracts.golive_contract_sen) was stored as RM 105,280.50, the contract before its
--    RM -3,000 VO, because the VO was approved in the ERP after go-live though agreed in May 2025. The contract at
--    go-live is RM 102,280.50 (the SO total); billing reads the greater of this and what AutoCount invoiced, so the
--    old figure showed RM 3,000 more received than the customer paid (RM 77,902).
-- 2. Its payment terms were imported as 30/30/35/5; the contract was billed 10/50/35/5 ("我以前的收款方式是10%，
--    50%，35%，5%"). Instalments 1 and 2 become 10% and 50%; 3 and 4 stay. Only while nothing is billed on it in the
--    ERP (the same rule as applying a payment-term template), and only from exactly 30/30.
--
-- REVERSAL: update scm.reno_so_contracts set golive_contract_sen = 10528050 where so_doc_no = 'TC-SO-2505-001';
--   update scm.reno_doc_instalments set pct_bp = 3000 where so_doc_no = 'TC-SO-2505-001' and seq in (1, 2);

update scm.reno_so_contracts
   set golive_contract_sen = 10228050, updated_at = now()
 where so_doc_no = 'TC-SO-2505-001' and golive_contract_sen = 10528050;

update scm.reno_doc_instalments i
   set pct_bp = case i.seq when 1 then 1000 when 2 then 5000 end
 where i.so_doc_no = 'TC-SO-2505-001' and i.seq in (1, 2) and i.pct_bp = 3000
   and (select count(*) from scm.reno_doc_instalments x where x.so_doc_no = 'TC-SO-2505-001' and x.seq in (1, 2) and x.pct_bp = 3000) = 2
   and not exists (select 1 from scm.reno_instalment_bills b where b.so_doc_no = 'TC-SO-2505-001');
