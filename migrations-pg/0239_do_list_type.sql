-- REVERSAL: drop function scm.do_list_type(scm.delivery_orders);
-- The Delivery Orders type tabs (owner, 6 Nov 2026): Works POD, Furniture and Built-in, Loose items. The type follows the DO's
-- lines, heaviest kind first, so a mixed DO has one type. A computed field read through PostgREST rather than a stored
-- column: nothing to keep in step on every line write, and a SKU moved to another category moves its DOs with it.
-- The groups are the catalog's (renovation-catalog.ts): categoryGroupOf and siteGroupOf, legacy categories included.
set local lock_timeout = '5s';

create or replace function scm.do_list_type(d scm.delivery_orders) returns text
language sql stable as $$
  select case
    when coalesce(bool_or(
      g.category = 'WORKS' or (g.category = 'SERVICE' and upper(coalesce(g.sub_category, '')) in ('AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT'))
    ), false) then 'works_pod'
    when coalesce(bool_or(
      g.category in ('BUILTIN', 'FURNITURE', 'SOFA', 'BEDFRAME', 'MATTRESS', 'DINING', 'ACCESSORY', 'FABRIC_ACCESSORY', 'OTHERS')
    ), false) then 'furniture'
    else 'loose'
  end
  from (
    select upper(coalesce(p.category::text, i.item_group, '')) as category, p.sub_category::text as sub_category
    from scm.delivery_order_items i
    left join scm.mfg_products p on p.code = i.item_code and p.company_id = d.company_id
    where i.delivery_order_id = d.id
  ) g
$$;

revoke all on function scm.do_list_type(scm.delivery_orders) from public;
grant execute on function scm.do_list_type(scm.delivery_orders) to pos_app, service_role;

notify pgrst, 'reload schema';
