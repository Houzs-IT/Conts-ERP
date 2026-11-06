-- REVERSAL: refused while a production order or an attachment on one exists. drop trigger trg_production_po on scm.purchase_orders; drop trigger trg_production_po_item on scm.purchase_order_items; drop trigger trg_no_inhouse_payable on scm.purchase_invoices; (same on scm.ap_invoices, scm.payment_requests, scm.payment_vouchers); drop table scm.production_order_items, scm.production_orders; drop function scm.production_sync_po(uuid), scm.production_po_changed(), scm.production_po_item_changed(), scm.refuse_inhouse_payable(); put doc_attachments_type_check back without 'production_order'.
-- Production orders (owner, 4 Nov 2026: "copy the purchase order exactly into production order"). A straight clone of the
-- PO tables, same column names, so the cloned screens save and load, and he shapes the content from there. Nothing reads
-- these tables but the production screens: a production order is in no PO list, MRP, GRN, AP, accounting or supplier email.
-- po_number holds the TC-PRO-YYMM-NNN number. No SO quota, no allocations, no AutoCount on them.
--
-- A PO to INHOUSE, once issued, also makes one (spec 2026-11-01, "Owner answers"): trg_production_po copies it, and a
-- cancelled or reopened PO takes its production order along. It is kept on the tables because a PO reaches SUBMITTED by
-- five paths and its header lands before its lines. New PO lines are copied across; after that the copy is its own
-- document and edits stay on it. source_po_id is the only link. A PO to INHOUSE also posts no payable, on any path.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, select demo.drop_views() first and
-- select demo.sync() last; staging first, then production, BEFORE the code that needs it merges.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.production_orders (like scm.purchase_orders including defaults);
alter table scm.production_orders
  add column source_po_id uuid unique references scm.purchase_orders(id),
  alter column id set not null,
  add constraint production_orders_pkey primary key (id),
  add constraint production_orders_po_number_unique unique (po_number),
  add constraint production_orders_company_id_fkey foreign key (company_id) references public.companies(id),
  add constraint production_orders_created_by_fkey foreign key (created_by) references scm.staff(id) on delete restrict,
  add constraint production_orders_project_id_fkey foreign key (project_id) references public.projects(id) on delete set null,
  add constraint production_orders_purchase_location_fkey foreign key (purchase_location_id) references scm.warehouses(id) on delete set null,
  add constraint production_orders_supplier_id_fkey foreign key (supplier_id) references scm.suppliers(id) on delete restrict;
create index idx_production_orders_company on scm.production_orders (company_id);
create index idx_production_orders_status on scm.production_orders (status);
create index idx_production_orders_supplier on scm.production_orders (supplier_id);
create index idx_production_orders_on_hold on scm.production_orders (company_id) where on_hold;
create index production_orders_project_idx on scm.production_orders (project_id) where project_id is not null;
alter table scm.production_orders owner to scm_engine;
alter table scm.production_orders enable row level security;
revoke all on scm.production_orders from anon, authenticated;
grant all on scm.production_orders to service_role, pos_app;

create table scm.production_order_items (like scm.purchase_order_items including defaults);
alter table scm.production_order_items rename column purchase_order_id to production_order_id;
alter table scm.production_order_items
  add column source_po_item_id uuid unique references scm.purchase_order_items(id) on delete set null,
  alter column id set not null,
  add constraint production_order_items_pkey primary key (id),
  add constraint production_order_items_binding_fkey foreign key (binding_id) references scm.supplier_material_bindings(id) on delete set null,
  add constraint production_order_items_company_id_fkey foreign key (company_id) references public.companies(id),
  add constraint production_order_items_order_fkey foreign key (production_order_id) references scm.production_orders(id) on delete cascade,
  add constraint production_order_items_so_item_fkey foreign key (so_item_id) references scm.mfg_sales_order_items(id) on delete set null,
  add constraint production_order_items_warehouse_fkey foreign key (warehouse_id) references scm.warehouses(id) on delete set null;
create index idx_production_order_items_order on scm.production_order_items (production_order_id);
create index idx_production_order_items_company on scm.production_order_items (company_id);
alter table scm.production_order_items owner to scm_engine;
alter table scm.production_order_items enable row level security;
revoke all on scm.production_order_items from anon, authenticated;
grant all on scm.production_order_items to service_role, pos_app;

alter table scm.doc_attachments drop constraint doc_attachments_type_check;
alter table scm.doc_attachments add constraint doc_attachments_type_check check (doc_type = any (array[
  'quotation', 'sales_order', 'variation_order', 'purchase_order', 'production_order', 'delivery_order', 'goods_received', 'delivery_return',
  'purchase_return', 'purchase_invoice', 'sales_invoice', 'receipt', 'credit_note', 'official_receipt', 'deposit_invoice',
  'payment_voucher', 'ap_invoice']));

create function scm.production_sync_po(p_po uuid) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare
  po scm.purchase_orders%rowtype; supplier_code text; pr_id uuid; pr_status text; live boolean;
  series text; used integer; n integer; added integer;
begin
  select * into po from scm.purchase_orders where id = p_po;
  if not found then return; end if;
  select code into supplier_code from scm.suppliers where id = po.supplier_id;
  select id, status::text into pr_id, pr_status from scm.production_orders where source_po_id = p_po for update;
  if supplier_code is distinct from 'INHOUSE' and pr_id is null then return; end if;
  live := supplier_code = 'INHOUSE' and po.status::text not in ('DRAFT', 'CANCELLED');

  if pr_id is null then
    if not live then return; end if;
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
    select id, status::text into pr_id, pr_status from scm.production_orders where source_po_id = p_po for update;
  end if;

  if not live then
    if pr_status not in ('CANCELLED', 'RECEIVED') then
      update scm.production_orders set status = 'CANCELLED', cancelled_at = now(), updated_at = now() where id = pr_id;
    end if;
    return;
  end if;

  if pr_status = 'CANCELLED' then
    update scm.production_orders set status = 'SUBMITTED', cancelled_at = null, updated_at = now() where id = pr_id;
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
     and not exists (select 1 from scm.production_order_items x where x.source_po_item_id = i.id)
  on conflict (source_po_item_id) do nothing;
  get diagnostics added = row_count;
  if added > 0 then
    update scm.production_orders o
       set subtotal_sen = t.s, total_sen = t.s, updated_at = now()
      from (select coalesce(sum(line_total_sen), 0)::integer as s from scm.production_order_items where production_order_id = pr_id) t
     where o.id = pr_id;
  end if;
end $$;

create function scm.production_po_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  perform scm.production_sync_po(new.id);
  return null;
end $$;

create function scm.production_po_item_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  perform scm.production_sync_po(new.purchase_order_id);
  return null;
end $$;

create trigger trg_production_po
  after insert or update of status, supplier_id, project_id on scm.purchase_orders
  for each row execute function scm.production_po_changed();
create trigger trg_production_po_item
  after insert on scm.purchase_order_items
  for each row execute function scm.production_po_item_changed();

create function scm.refuse_inhouse_payable() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  if new.supplier_id is not null and exists (select 1 from scm.suppliers s where s.id = new.supplier_id and s.code = 'INHOUSE') then
    raise exception 'The In-house Production Team is our own team: it has no invoices or payments.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_no_inhouse_payable before insert or update of supplier_id on scm.purchase_invoices
  for each row execute function scm.refuse_inhouse_payable();
create trigger trg_no_inhouse_payable before insert or update of supplier_id on scm.ap_invoices
  for each row execute function scm.refuse_inhouse_payable();
create trigger trg_no_inhouse_payable before insert or update of supplier_id on scm.payment_requests
  for each row execute function scm.refuse_inhouse_payable();
create trigger trg_no_inhouse_payable before insert or update of supplier_id on scm.payment_vouchers
  for each row execute function scm.refuse_inhouse_payable();

notify pgrst, 'reload schema';
