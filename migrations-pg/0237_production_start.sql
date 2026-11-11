-- REVERSAL: refused once an order has started: put its stock back first. drop trigger trg_production_plan_start on scm.production_orders; drop trigger trg_production_po_item_edit on scm.purchase_order_items; drop trigger trg_production_po_item_gone on scm.purchase_order_items; drop function scm.production_plan_start(), scm.production_po_item_edit(), scm.production_po_item_gone(), scm.production_totals(uuid); drop view scm.production_holidays, scm.production_workers; drop function pos.production_day_off(), pos.production_worker_list(); drop table scm.production_order_workers; alter table scm.production_order_materials drop column qty_issued, drop column qty_returned, drop column qty_issued_short, drop column added_how, drop column requested_at, drop column requested_by_name; alter table scm.production_orders drop column plan_start, drop column production_time_hours, drop column actual_start_at, drop column actual_start_by, drop column actual_start_by_name, drop column start_lock_at; put back scm.production_sync_po and scm.production_po_changed from 0208.
-- Pressing Start on a production order (owner, 6 Nov 2026): stock and raw materials leave at Start, actual dates come from
-- Start and Complete, workers are assigned or become so by pressing Start.
--
--   production_orders.plan_start             the planned first day. Plan finish is expected_at, already on the order.
--   production_orders.production_time_hours  management's budget in hours, typed by hand. Never worked out from days.
--   production_orders.actual_start_at/_by/_by_name  who pressed Start and when. Actual finish is received_at.
--   production_orders.start_lock_at          a Start in flight, so two presses cannot both issue stock.
--   production_order_materials.qty_issued    whole units that left stock (a fractional need rounds up at Start).
--   production_order_materials.qty_returned  whole units sent back with Return stock.
--   production_order_materials.qty_issued_short  units issued past the pooled balance: what MRP must still buy.
--   production_order_materials.added_how     LISTED before Start, REQUESTED with Request more after it.
--   production_order_workers                 ASSIGNED by hand, or STARTED by pressing Start.
--   inventory_movements.source_doc_type      text with no check constraint, so 'PRODUCTION_ORDER' needs no schema change;
--                                            source_doc_id is the material's id, because one order may list a SKU twice.
--   scm.production_holidays, scm.production_workers
--                                            the company's holiday list and in-house technicians, which live in pos where
--                                            PostgREST cannot reach, read through definer functions owned by pos_app.
--
-- Audit fixes carried here: a change to a PO line now reaches its open production order (the triggers of 0208 only ever
-- inserted), with a history row so the workers see it; a PO no longer revives a cancelled order on every small update,
-- only when the PO itself comes back from cancelled; a PO cannot cancel a started order behind its back, because the
-- order must give its stock back first.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, staging first, then production, BEFORE the
-- code that needs it merges.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.production_orders
  add column if not exists plan_start date,
  add column if not exists production_time_hours numeric(8,1) check (production_time_hours is null or production_time_hours >= 0),
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_start_by uuid references scm.staff(id) on delete set null,
  add column if not exists actual_start_by_name text,
  add column if not exists start_lock_at timestamptz;

update scm.production_orders set plan_start = po_date where plan_start is null and po_date is not null;

create or replace function scm.production_plan_start() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  new.plan_start := coalesce(new.plan_start, new.po_date, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  return new;
end $$;
alter function scm.production_plan_start() owner to scm_engine;
drop trigger if exists trg_production_plan_start on scm.production_orders;
create trigger trg_production_plan_start before insert on scm.production_orders
  for each row execute function scm.production_plan_start();

alter table scm.production_order_materials
  add column if not exists qty_issued integer not null default 0 check (qty_issued >= 0),
  add column if not exists qty_returned integer not null default 0 check (qty_returned >= 0),
  add column if not exists qty_issued_short integer not null default 0 check (qty_issued_short >= 0),
  add column if not exists added_how text not null default 'LISTED' check (added_how in ('LISTED', 'REQUESTED')),
  add column if not exists requested_at timestamptz,
  add column if not exists requested_by_name text;
alter table scm.production_order_materials drop constraint if exists production_order_materials_returned_within_issued;
alter table scm.production_order_materials add constraint production_order_materials_returned_within_issued check (qty_returned <= qty_issued);

create table if not exists scm.production_order_workers (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references scm.production_orders(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  person_key text not null,
  name text not null,
  trade text,
  how text not null check (how in ('ASSIGNED', 'STARTED')),
  created_at timestamptz not null default now(),
  created_by uuid references scm.staff(id) on delete set null,
  unique (production_order_id, person_key)
);
create index if not exists production_order_workers_order_idx on scm.production_order_workers (production_order_id);
alter table scm.production_order_workers owner to scm_engine;
alter table scm.production_order_workers enable row level security;
revoke all on scm.production_order_workers from anon, authenticated;
grant all on scm.production_order_workers to service_role, pos_app;

create or replace function pos.production_day_off() returns table (holiday_date text, state text, name text)
language sql stable security definer set search_path = pos, pg_temp as $$
  select holiday_date, state, name from pos.public_holidays where staff_day_off
$$;
alter function pos.production_day_off() owner to pos_app;
revoke all on function pos.production_day_off() from public;
grant execute on function pos.production_day_off() to service_role, pos_app, scm_engine;

create or replace function pos.production_worker_list() returns table (id text, name text, trade text)
language sql stable security definer set search_path = pos, pg_temp as $$
  select t.id, t.full_name, e.position
    from pos.technicians t
    left join pos.employees e on e.technician_id = t.id
   where t.is_active = 1 and t.employment_type = 'internal' and coalesce(e.status, 'active') = 'active'
$$;
alter function pos.production_worker_list() owner to pos_app;
revoke all on function pos.production_worker_list() from public;
grant execute on function pos.production_worker_list() to service_role, pos_app, scm_engine;

create or replace view scm.production_holidays as select holiday_date, state, name from pos.production_day_off();
create or replace view scm.production_workers as select id, name, trade from pos.production_worker_list();
revoke all on scm.production_holidays, scm.production_workers from anon, authenticated;
grant select on scm.production_holidays, scm.production_workers to service_role, pos_app;

create or replace function scm.production_totals(p_order uuid) returns void
language sql set search_path = scm, pg_temp as $$
  update scm.production_orders o
     set subtotal_sen = t.s, total_sen = t.s, updated_at = now()
    from (select coalesce(sum(line_total_sen), 0)::integer as s from scm.production_order_items where production_order_id = p_order) t
   where o.id = p_order
$$;

create or replace function scm.production_po_item_edit() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare x record;
begin
  select i.id as item_id, o.id as order_id, o.po_number, o.company_id, o.status::text as status, o.actual_start_at
    into x
    from scm.production_order_items i join scm.production_orders o on o.id = i.production_order_id
   where i.source_po_item_id = new.id;
  if not found or x.status in ('RECEIVED', 'CANCELLED') then return null; end if;
  update scm.production_order_items
     set qty = new.qty, unit_price_sen = new.unit_price_sen, line_total_sen = new.line_total_sen, discount_sen = new.discount_sen,
         item_code = new.item_code, material_name = new.material_name, description = new.description, description2 = new.description2,
         notes = new.notes, delivery_date = new.delivery_date, warehouse_id = new.warehouse_id, variants = new.variants, uom = new.uom
   where id = x.item_id;
  perform scm.production_totals(x.order_id);
  if x.actual_start_at is not null then
    insert into scm.entity_audit_log (company_id, entity_type, entity_id, entity_doc_no, action, field_changes, note, source)
    values (x.company_id, 'PRODUCTION_ORDER', x.order_id, x.po_number, 'UPDATE', '[]'::jsonb,
            case when old.qty is distinct from new.qty
                 then new.item_code || ' ' || trim_scale(old.qty::numeric) || ' to ' || trim_scale(new.qty::numeric) || coalesce(' ' || new.uom, '')
                 else new.item_code || ' changed' end,
            'po_sync');
  end if;
  return null;
end $$;
drop trigger if exists trg_production_po_item_edit on scm.purchase_order_items;
create trigger trg_production_po_item_edit
  after update of qty, unit_price_sen, line_total_sen, discount_sen, item_code, material_name, description, description2, notes, delivery_date, warehouse_id, variants, uom
  on scm.purchase_order_items
  for each row
  when (old.qty is distinct from new.qty or old.unit_price_sen is distinct from new.unit_price_sen or old.line_total_sen is distinct from new.line_total_sen
     or old.discount_sen is distinct from new.discount_sen or old.item_code is distinct from new.item_code or old.material_name is distinct from new.material_name
     or old.description is distinct from new.description or old.description2 is distinct from new.description2 or old.notes is distinct from new.notes
     or old.delivery_date is distinct from new.delivery_date or old.warehouse_id is distinct from new.warehouse_id or old.variants is distinct from new.variants or old.uom is distinct from new.uom)
  execute function scm.production_po_item_edit();

-- Before delete: the foreign key would blank source_po_item_id first and the copy could no longer be found.
create or replace function scm.production_po_item_gone() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare x record;
begin
  select i.id as item_id, o.id as order_id, o.po_number, o.company_id, o.status::text as status, o.actual_start_at
    into x
    from scm.production_order_items i join scm.production_orders o on o.id = i.production_order_id
   where i.source_po_item_id = old.id;
  if found and x.status not in ('RECEIVED', 'CANCELLED') then
    delete from scm.production_order_items where id = x.item_id;
    perform scm.production_totals(x.order_id);
    if x.actual_start_at is not null then
      insert into scm.entity_audit_log (company_id, entity_type, entity_id, entity_doc_no, action, field_changes, note, source)
      values (x.company_id, 'PRODUCTION_ORDER', x.order_id, x.po_number, 'UPDATE', '[]'::jsonb, old.item_code || ' removed', 'po_sync');
    end if;
  end if;
  return old;
end $$;
drop trigger if exists trg_production_po_item_gone on scm.purchase_order_items;
create trigger trg_production_po_item_gone before delete on scm.purchase_order_items
  for each row execute function scm.production_po_item_gone();

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
     and not exists (select 1 from scm.production_order_items x where x.source_po_item_id = i.id)
  on conflict (source_po_item_id) do nothing;
  get diagnostics added = row_count;
  if added > 0 then perform scm.production_totals(pr_id); end if;
end $$;

-- A cancelled order comes back only when its PO itself comes back from cancelled, not on every later update of that PO.
create or replace function scm.production_po_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.status::text = 'CANCELLED' and new.status::text not in ('DRAFT', 'CANCELLED') then
    update scm.production_orders set status = 'SUBMITTED', cancelled_at = null, updated_at = now()
     where source_po_id = new.id and status = 'CANCELLED'
       and exists (select 1 from scm.suppliers s where s.id = new.supplier_id and s.code = 'INHOUSE');
  end if;
  perform scm.production_sync_po(new.id);
  return null;
end $$;

notify pgrst, 'reload schema';

select demo.sync();
