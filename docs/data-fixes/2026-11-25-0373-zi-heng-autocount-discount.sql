-- APPLIED to production on 25 Nov 2026 as migration 0373 (migrate-production.yml, --only=0373). Kept here, not in
-- migrations-pg: it is a one-off fix of one production contract; public.pos_migrations keeps its row.

-- 0373_zi_heng_autocount_discount: one-off data fix of one production contract, MR ZI HENG, MYARA PARK R-19-08
-- (TC-SO-2605-007), chew 25 Nov 2026 ("两张都改"). On an empty database (CI, staging) the rows are not there and nothing
-- changes.
--
-- AutoCount invoiced the contract whole (I-2605-087, RM 35,500) and then gave a discount on it, CN-000077 (17/08/2026,
-- RM 1,740.60). The go-live import kept the RM 35,500 and read "paid before go-live" as invoiced less still owed, so the
-- discount read as money received: contract RM 35,500, received RM 33,812.03. The customer paid RM 32,071.43 (OR-003341
-- 3,550, OR-003913 16,706, OR-004387 11,815.43) on a contract of RM 33,759.40, as chew's tracker says; still owed
-- RM 1,687.97 is the same either way.
--
-- 1. The contract comes down by the discount: one RENO-CREDIT line of RM -1,740.60 (as a contract credit note's line
--    reads), and the order's header totals follow (scm/lib/renovation-so recomputeSoHeader). No credit note is raised and
--    nothing posts: CN-000077 is in the books already, from AutoCount.
-- 2. What AutoCount invoiced on it, net of that discount, is RM 33,759.40 (reno_so_contracts billed_before_golive_sen and
--    golive_contract_sen, where they read RM 35,500), so paid before go-live reads RM 32,071.43.
--
-- REVERSAL:
--   delete from scm.mfg_sales_order_items where doc_no = 'TC-SO-2605-007' and item_code = 'RENO-CREDIT' and description like 'AutoCount CN-000077%';
--   (then the header totals as below), and
--   update scm.reno_so_contracts set billed_before_golive_sen = case when billed_before_golive_sen = 3375940 then 3550000 else billed_before_golive_sen end,
--     golive_contract_sen = case when golive_contract_sen = 3375940 then 3550000 else golive_contract_sen end where so_doc_no = 'TC-SO-2605-007';

set local lock_timeout = '5s';

insert into scm.mfg_sales_order_items (id, doc_no, line_date, debtor_name, item_group, item_code, description, uom, location,
    qty, unit_price_sen, discount_sen, total_sen, total_inc_sen, balance_sen, unit_cost_sen, line_cost_sen, line_margin_sen, line_no, company_id)
select gen_random_uuid(), o.doc_no, date '2026-08-17', o.debtor_name, 'RENOVATION', 'RENO-CREDIT',
       'AutoCount CN-000077 (17/08/2026): discount, booked in AutoCount before go-live', 'LOT', '',
       1, -174060, 0, -174060, -174060, -174060, 0, 0, -174060,
       coalesce((select max(i.line_no) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no), 0) + 1, o.company_id
  from scm.mfg_sales_orders o
 where o.doc_no = 'TC-SO-2605-007'
   and (select coalesce(sum(i.total_sen), 0) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and not i.cancelled) = 3550000
   and not exists (select 1 from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and i.description like 'AutoCount CN-000077%');

with s as (
  select coalesce(sum(total_sen), 0)::int as total, coalesce(sum(line_cost_sen), 0)::int as cost, count(*)::int as n
    from scm.mfg_sales_order_items where doc_no = 'TC-SO-2605-007' and not cancelled)
update scm.mfg_sales_orders o set
   local_total_sen = s.total, subtotal_sen = s.total, total_revenue_sen = s.total, others_sen = s.total,
   total_cost_sen = s.cost, others_cost_sen = s.cost, total_margin_sen = s.total - s.cost, line_count = s.n,
   balance_sen = s.total - o.paid_sen, version = o.version + 1, updated_at = now()
  from s
 where o.doc_no = 'TC-SO-2605-007' and o.local_total_sen is distinct from s.total;

update scm.reno_so_contracts
   set billed_before_golive_sen = case when billed_before_golive_sen = 3550000 then 3375940 else billed_before_golive_sen end,
       golive_contract_sen = case when golive_contract_sen = 3550000 then 3375940 else golive_contract_sen end,
       updated_at = now()
 where so_doc_no = 'TC-SO-2605-007' and (billed_before_golive_sen = 3550000 or golive_contract_sen = 3550000);
