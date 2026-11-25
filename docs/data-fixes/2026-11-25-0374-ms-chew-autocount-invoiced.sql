-- APPLIED to production on 25 Nov 2026 as migration 0374 (migrate-production.yml, --only=0374). Kept here, not in
-- migrations-pg: it is a one-off fix of one production contract; public.pos_migrations keeps its row.

-- 0374_ms_chew_autocount_invoiced: one-off data fix of one production contract, MS CHEW, AVA KIARA BAY B15-11
-- (TC-SO-2512-001), chew 25 Nov 2026 ("你自己看"). On an empty database (CI, staging) the rows are not there and nothing
-- changes.
--
-- AutoCount invoiced her RM 42,800 (I-2512-042 RM 35,397, I-2604-094 RM 7,403) less CN-000075 RM 194: RM 42,606, the
-- contract in chew's tracker. She paid RM 39,846.80 (OR-002423 500, OR-002422 3,040, OR-003400 21,626.40, OR-004016
-- 14,680.40) and owed RM 2,759.20 at the cut-over (I-2604-094), as the tracker says. The go-live seed carried only
-- RM 35,547 as what AutoCount invoiced and booked (billed_before_golive_sen, golive_contract_sen), so the system read
-- received RM 32,787.80; and the order's lines come to RM 41,944, RM 662 short of what she was billed.
--
-- 1. One RENO-ADJUST line of RM 662 brings the contract to RM 42,606, what AutoCount billed; the order's header totals
--    follow (scm/lib/renovation-so recomputeSoHeader). Nothing posts.
-- 2. What AutoCount invoiced and booked on it is RM 42,606 (billed_before_golive_sen and golive_contract_sen, where they
--    read RM 35,547), so paid before go-live reads RM 39,846.80 and the contract reads as posted in full.
-- With her RM 2,097.60 waiting for finance (TC-DraftOR-2611-017), RM 661.60 is left to collect.
--
-- REVERSAL:
--   delete from scm.mfg_sales_order_items where doc_no = 'TC-SO-2512-001' and item_code = 'RENO-ADJUST' and description like 'AutoCount billed RM 42,606%';
--   (then the header totals as below), and
--   update scm.reno_so_contracts set billed_before_golive_sen = case when billed_before_golive_sen = 4260600 then 3554700 else billed_before_golive_sen end,
--     golive_contract_sen = case when golive_contract_sen = 4260600 then 3554700 else golive_contract_sen end where so_doc_no = 'TC-SO-2512-001';

set local lock_timeout = '5s';

insert into scm.mfg_sales_order_items (id, doc_no, line_date, debtor_name, item_group, item_code, description, uom, location,
    qty, unit_price_sen, discount_sen, total_sen, total_inc_sen, balance_sen, unit_cost_sen, line_cost_sen, line_margin_sen, line_no, company_id)
select gen_random_uuid(), o.doc_no, date '2026-04-24', o.debtor_name, 'RENOVATION', 'RENO-ADJUST',
       'AutoCount billed RM 42,606 (I-2512-042, I-2604-094, less CN-000075) before go-live: RM 662 over these lines', 'LOT', '',
       1, 66200, 0, 66200, 66200, 66200, 0, 0, 66200,
       coalesce((select max(i.line_no) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no), 0) + 1, o.company_id
  from scm.mfg_sales_orders o
 where o.doc_no = 'TC-SO-2512-001'
   and (select coalesce(sum(i.total_sen), 0) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and not i.cancelled) = 4194400
   and not exists (select 1 from scm.mfg_sales_order_items i where i.doc_no = o.doc_no and i.description like 'AutoCount billed RM 42,606%');

with s as (
  select coalesce(sum(total_sen), 0)::int as total, coalesce(sum(line_cost_sen), 0)::int as cost, count(*)::int as n
    from scm.mfg_sales_order_items where doc_no = 'TC-SO-2512-001' and not cancelled)
update scm.mfg_sales_orders o set
   local_total_sen = s.total, subtotal_sen = s.total, total_revenue_sen = s.total, others_sen = s.total,
   total_cost_sen = s.cost, others_cost_sen = s.cost, total_margin_sen = s.total - s.cost, line_count = s.n,
   balance_sen = s.total - o.paid_sen, version = o.version + 1, updated_at = now()
  from s
 where o.doc_no = 'TC-SO-2512-001' and o.local_total_sen is distinct from s.total;

update scm.reno_so_contracts
   set billed_before_golive_sen = case when billed_before_golive_sen = 3554700 then 4260600 else billed_before_golive_sen end,
       golive_contract_sen = case when golive_contract_sen = 3554700 then 4260600 else golive_contract_sen end,
       updated_at = now()
 where so_doc_no = 'TC-SO-2512-001' and (billed_before_golive_sen = 3554700 or golive_contract_sen = 3554700);
