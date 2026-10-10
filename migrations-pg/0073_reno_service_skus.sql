-- REVERSAL: DELETE FROM scm.mfg_products WHERE id IN ('mfg-reno-adjust', 'mfg-reno-discount', 'mfg-reno-progress') AND NOT EXISTS (SELECT 1 FROM scm.mfg_sales_order_items i WHERE i.item_code IN ('RENO-ADJUST', 'RENO-DISCOUNT', 'RENO-PROGRESS'));
-- Three service SKUs the renovation documents write on the engine's own rows; none ever goes on a purchase order.
--   RENO-ADJUST    the priced row of a lump-sum section on a contract (its lines carry no price of their own);
--   RENO-DISCOUNT  the document discount (e.g. showroom discount) as one negative contract row;
--   RENO-PROGRESS  the single line of a progress-billing sales invoice.
insert into scm.mfg_products (id, code, name, category, description, status, cost_price_sen, pos_active, company_id)
select v.id, v.code, v.name, 'SERVICE'::scm.mfg_product_category, v.description, 'ACTIVE'::scm.mfg_product_status, 0, false, 1
from (values
  ('mfg-reno-adjust', 'RENO-ADJUST', 'Renovation lump sum', 'Priced row of a lump-sum section on a renovation contract'),
  ('mfg-reno-discount', 'RENO-DISCOUNT', 'Renovation document discount', 'Document discount on a renovation contract (negative)'),
  ('mfg-reno-progress', 'RENO-PROGRESS', 'Renovation progress billing', 'Progress-billing instalment of a renovation contract')
) as v(id, code, name, description)
where not exists (select 1 from scm.mfg_products p where p.code = v.code and p.company_id = 1);
