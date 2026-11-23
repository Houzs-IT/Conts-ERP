-- APPLIED to production on 23 Nov 2026 as migration 0367 (migrate-production.yml, --only=0367). Kept here, not in
-- migrations-pg: it is a one-off fix of one production contract; public.pos_migrations keeps its row.

-- 0367_yau_unit_a21_11: one-off data fix of one production contract, MR YAU at AVA (TC-SO-2512-003), chew 23 Nov 2026:
-- the unit is A21-11 (AutoCount 301-M027 "MR YAU (AVA A21-11)", project A-2111(R)), not D21-11 as imported. The SO's
-- order information cannot be saved from its page without the customer's phone, which is not on record yet ("可以先挂
-- 过去吗"), so the unit is set here. Only rows that still say D21-11 change; on an empty database nothing does.
--
-- REVERSAL: the same updates with 'A21-11' and 'D21-11' swapped.

update scm.mfg_sales_orders
   set unit_no = 'A21-11',
       address2 = case when address2 = 'D21-11' then 'A21-11' else address2 end,
       updated_at = now()
 where doc_no = 'TC-SO-2512-003' and unit_no = 'D21-11';

update public.projects p
   set unit_no = case when p.unit_no = 'D21-11' then 'A21-11' else p.unit_no end,
       address2 = case when p.address2 = 'D21-11' then 'A21-11' else p.address2 end,
       site_address = replace(p.site_address, 'D21-11', 'A21-11'),
       name = replace(p.name, 'D21-11', 'A21-11')
 where p.id = (select o.project_id from scm.mfg_sales_orders o where o.doc_no = 'TC-SO-2512-003')
   and (p.name like '%D21-11%' or p.unit_no = 'D21-11');
