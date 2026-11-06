-- REVERSAL: UPDATE scm.mfg_sales_order_items SET warehouse_id = NULL and scm.mfg_sales_orders SET warehouse_id = NULL for
-- the orders below; before this file every project order and line had none, so nothing else is lost.
-- Renovation contracts were converted from quotations without a state or warehouse, so the address never set one and
-- every project order sat blank (owner, 4 Nov 2026: 地址那边就 set 好了). Same rule as a new contract: the project's state
-- through state_warehouse_mappings, else the company's default. Only blanks are filled; the state is taken from the
-- project where the order has none. Lines take their order's warehouse.
UPDATE scm.mfg_sales_orders o
   SET warehouse_id = COALESCE(
         (SELECT m.warehouse_id FROM scm.state_warehouse_mappings m JOIN public.projects p ON p.id = o.project_id
           WHERE m.company_id = o.company_id AND m.state::text = p.state LIMIT 1),
         (SELECT w.id FROM scm.warehouses w WHERE w.company_id = o.company_id AND w.is_default AND w.is_active ORDER BY w.code LIMIT 1)),
       customer_state = COALESCE(NULLIF(o.customer_state, ''), (SELECT NULLIF(p.state, '') FROM public.projects p WHERE p.id = o.project_id))
 WHERE o.warehouse_id IS NULL AND o.project_id IS NOT NULL;

UPDATE scm.mfg_sales_order_items i
   SET warehouse_id = o.warehouse_id
  FROM scm.mfg_sales_orders o
 WHERE o.doc_no = i.doc_no AND i.warehouse_id IS NULL AND o.project_id IS NOT NULL AND o.warehouse_id IS NOT NULL;
