-- REVERSAL: drop trigger trg_production_no_builtin on scm.production_order_items; drop function scm.production_no_builtin(); put back scm.production_sync_po from 0236; drop function scm.production_builtin_line(bigint, text, text).
-- Built-in is sales order to PO only (owner, 7 Nov 2026): 0221 binds Built-in SKUs to In-house by default and the sync read
-- only the supplier, so such a PO made a Production Order. The order now comes with its first line that may be made, so a
-- Built-in PO makes none, and it is received with a goods receipt like any other PO.
select demo.drop_views();
set local lock_timeout = '5s';

create or replace function scm.production_builtin_line(p_company bigint, p_code text, p_group text) returns boolean
language sql stable set search_path = scm, pg_temp as $$
  select upper(coalesce(p_group, '')) = 'BUILTIN'
      or exists (select 1 from scm.mfg_products p
                  where p.code = p_code and p.company_id = p_company
                    and (upper(p.category::text) = 'BUILTIN' or upper(coalesce(p.category_group::text, '')) = 'BUILTIN'));
$$;

create or replace function scm.production_no_builtin() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  if scm.production_builtin_line(new.company_id, new.item_code, new.category_group) then
    raise exception '% is Built-in: it goes on a PO, not a production order.', new.item_code using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_production_no_builtin on scm.production_order_items;
create trigger trg_production_no_builtin before insert on scm.production_order_items
  for each row execute function scm.production_no_builtin();

create or replace function scm.production_sync_po(p_po uuid) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare
  po scm.purchase_orders%rowtype; supplier_code text; pr_id uuid; pr_status text; pr_no text; pr_started timestamptz; live boolean;
  series text; used integer; n integer; added integer;
begin
  select * into po from scm.purchase_orders where id = p_po;
  if not found then return; end if;
  select code into supplier_code from scm.suppliers where id = po.supplier_id;
  select id, status::text, po_number, actual_start_at into pr_id, pr_status, pr_no, pr_started from scm.production_orders where source_po_id = p_po for update;
  if supplier_code is distinct from 'INHOUSE' and pr_id is null then return; end if;
  live := supplier_code = 'INHOUSE' and po.status::text not in ('DRAFT', 'CANCELLED');

  if pr_id is null then
    if not live then return; end if;
    if not exists (select 1 from scm.purchase_order_items i
                    where i.purchase_order_id = p_po and not scm.production_builtin_line(i.company_id, i.item_code, i.category_group)) then
      return;
    end if;
    series := coalesce(substring(po.po_number from '^(.*)PO-'), '') || 'PRO-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYMM');
    select coalesce(max(substring(po_number from '[0-9]+$')::integer), 0) into used
      from scm.production_orders where po_number like series || '-%';
    n := scm.next_doc_no_n(series, used);
    insert into scm.production_orders
      (po_number, source_po_id, company_id, supplier_id, status, po_date, expected_at, purchase_location_id, currency,
       notes, submitted_at, created_by, project_id, category_group, sub_category, attention, display_term)
    values (series || '-' || lpad(n::text, 3, '0'), p_po, po.company_id, po.supplier_id, 'SUBMITTED', po.po_date, po.expected_at,
            po.purchase_location_id, po.currency, po.notes, now(), po.created_by, po.project_id, po.category_group, po.sub_category,
            po.attention, po.display_term)
    on conflict (source_po_id) do nothing;
    select id, status::text, po_number, actual_start_at into pr_id, pr_status, pr_no, pr_started from scm.production_orders where source_po_id = p_po for update;
  end if;

  if not live then
    if pr_status not in ('CANCELLED', 'RECEIVED') then
      if pr_started is not null then
        raise exception '% has started. Cancel the production order first, so its stock goes back.', pr_no using errcode = 'check_violation';
      end if;
      update scm.production_orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = pr_id;
    end if;
    return;
  end if;

  update scm.production_orders set project_id = coalesce(project_id, po.project_id) where id = pr_id and project_id is null and po.project_id is not null;

  insert into scm.production_order_items
    (production_order_id, source_po_item_id, company_id, binding_id, material_kind, item_code, material_name, supplier_sku, qty,
     unit_price_sen, line_total_sen, notes, variants, item_group, description, description2, uom, discount_sen, delivery_date,
     warehouse_id, so_item_id, photo_urls, line_no, room, category_group, sub_category)
  select pr_id, i.id, i.company_id, i.binding_id, i.material_kind, i.item_code, i.material_name, i.supplier_sku, i.qty,
         i.unit_price_sen, i.line_total_sen, i.notes, i.variants, i.item_group, i.description, i.description2, i.uom, i.discount_sen,
         i.delivery_date, i.warehouse_id, i.so_item_id, i.photo_urls, i.line_no, i.room, i.category_group, i.sub_category
    from scm.purchase_order_items i
   where i.purchase_order_id = p_po
     and not scm.production_builtin_line(i.company_id, i.item_code, i.category_group)
     and not exists (select 1 from scm.production_order_items x where x.source_po_item_id = i.id)
  on conflict (source_po_item_id) do nothing;
  get diagnostics added = row_count;
  if added > 0 then perform scm.production_totals(pr_id); end if;
end $$;

notify pgrst, 'reload schema';

select demo.sync();
