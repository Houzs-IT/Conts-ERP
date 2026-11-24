-- REVERSAL: re-run the two function bodies from migration 0116_reno_doc_flow.sql (scm.reno_flow_po_item with the
-- "A renovation purchase order holds one category" check, scm.reno_flow_po_item_project with
-- category_group = coalesce(po.category_group, new.category_group)).
-- Owner, 19 Nov 2026: the transaction flow does not restrict categories. A purchase order may hold lines of several
-- categories, as a sales order already does (mattress + sofa). Migration 0116's line trigger refused a renovation PO
-- line whose category differed from the PO's ("A renovation purchase order holds one category: this PO is BUILTIN,
-- the line CUR-GEN-DOUBLE is SOFT ..."), which stopped a buyer saving a PO from a sales order on 19 Nov.
-- * scm.reno_flow_po_item keeps filling the line's room and category from its SO line and product; the refusal goes.
-- * scm.reno_flow_po_item_project keeps the PO's project; the PO's category_group (and sub_category) is the one every
--   line shares, NULL when the lines mix. Readers of purchase_orders.category_group only display it or copy it onto a
--   production order, and both already take NULL (a Houzs PO has none).
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0345, dry run first.

set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create or replace function scm.reno_flow_po_item() returns trigger
language plpgsql as $$
declare p record;
begin
  if not scm.reno_flow_on() then return new; end if;
  if nullif(new.room, '') is null and new.so_item_id is not null then new.room := scm.reno_so_item_room(new.so_item_id); end if;
  if new.category_group is null and new.item_code is not null then
    select m.category_group, m.sub_category into p from scm.mfg_products m
     where m.code = new.item_code and m.company_id = new.company_id order by (m.status::text = 'ACTIVE') desc limit 1;
    if found then
      new.category_group := p.category_group;
      new.sub_category := coalesce(new.sub_category, p.sub_category);
    end if;
  end if;
  return new;
end $$;

create or replace function scm.reno_flow_po_item_project() returns trigger
language plpgsql as $$
declare pid bigint;
begin
  if not scm.reno_flow_on() then return null; end if;
  if new.so_item_id is not null then
    select scm.reno_so_project(i.doc_no) into pid from scm.mfg_sales_order_items i where i.id = new.so_item_id;
    if pid is not null then
      update scm.purchase_orders set project_id = pid where id = new.purchase_order_id and project_id is null;
    end if;
  end if;
  update scm.purchase_orders po set
         category_group = (select case when count(*) = count(x.category_group) and count(distinct x.category_group) = 1 then min(x.category_group) end
                             from scm.purchase_order_items x where x.purchase_order_id = po.id),
         sub_category = (select case when count(*) = count(x.sub_category) and count(distinct x.sub_category) = 1 then min(x.sub_category) end
                           from scm.purchase_order_items x where x.purchase_order_id = po.id)
   where po.id = new.purchase_order_id and po.project_id is not null;
  return null;
end $$;
