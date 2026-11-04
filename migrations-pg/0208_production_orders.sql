-- REVERSAL: refused while a production order exists. drop trigger trg_production_po on scm.purchase_orders; drop trigger trg_production_po_item on scm.purchase_order_items; drop trigger trg_no_inhouse_payable on scm.purchase_invoices; (same on scm.ap_invoices, scm.payment_requests, scm.payment_vouchers); alter table scm.purchase_order_items drop column production_material_id; drop table scm.production_order_materials, scm.production_order_lines, scm.production_orders, scm.production_material_lists; drop function scm.production_sync_po(uuid), scm.production_apply_list(uuid, uuid[]), scm.production_link_po(uuid, uuid[], bigint), scm.production_refresh_material(uuid), scm.production_po_changed(), scm.production_po_item_changed(), scm.refuse_inhouse_payable();
-- The production module (owner, 1 and 4 Nov 2026; docs/superpowers/specs/2026-11-01-dates-categories-production-design.md,
-- "Phase 2" and "Owner answers"). Works given to our own team are ordered on a PO to supplier INHOUSE.
--
--   scm.production_orders           one per PO to INHOUSE; its amount is the PO (the budget).
--   scm.production_order_lines      the PO's lines (the works), kept equal to the PO while it lives.
--   scm.production_order_materials  the raw materials the order needs; editable on the order.
--   scm.production_material_lists   the light per-SKU list: works SKU -> raw material SKU x qty per unit.
--   purchase_order_items.production_material_id
--                                   the raw-material PO line that buys a material. It sits on the PO line rather than
--                                   on the material (the spec's "optional link") because several POs may buy one
--                                   material, and a cancelled or deleted PO line then takes its link with it.
--
-- WHY TRIGGERS AND NOT THE ROUTES. A PO reaches SUBMITTED by five paths (POST /, /from-sos, /:id/confirm, /:id/reopen,
-- the project PO tab) and its header lands before its lines, so "created automatically, follows the PO" can only be kept
-- in one place by keeping it on the tables. It also costs a request on the Workers free plan no outside calls.
--
-- WHAT IS NOT HERE. Materials are not issued out of stock: received raw material stays on hand until an adjustment.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, select demo.drop_views() first and
-- select demo.sync() last; staging first, then production, BEFORE the code that needs it merges.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.production_orders (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null unique,
  company_id bigint not null references public.companies(id),
  source_po_id uuid not null unique references scm.purchase_orders(id),
  project_id bigint,
  so_doc_no text,
  warehouse_id uuid,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  processing_date date,
  target_date date,
  amount_sen integer not null default 0,
  actual_cost_sen integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by bigint
);
create index production_orders_company_idx on scm.production_orders (company_id, status);
create index production_orders_project_idx on scm.production_orders (project_id) where project_id is not null;
alter table scm.production_orders owner to scm_engine;
alter table scm.production_orders enable row level security;
revoke all on scm.production_orders from anon, authenticated;
grant all on scm.production_orders to service_role, pos_app;

create table scm.production_order_lines (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references scm.production_orders(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  po_item_id uuid not null unique references scm.purchase_order_items(id) on delete cascade,
  so_item_id uuid,
  line_no integer,
  item_code text not null,
  description text,
  room text,
  qty numeric(12,3) not null default 0,
  uom text,
  unit_price_sen integer not null default 0,
  line_total_sen integer not null default 0
);
create index production_order_lines_order_idx on scm.production_order_lines (production_order_id);
alter table scm.production_order_lines owner to scm_engine;
alter table scm.production_order_lines enable row level security;
revoke all on scm.production_order_lines from anon, authenticated;
grant all on scm.production_order_lines to service_role, pos_app;

-- qty_ordered, qty_received, unit_cost_sen and received_cost_sen are written only by scm.production_refresh_material.
-- from_list: the row came from the material list and still follows the works line's quantity; an edit ends that.
create table scm.production_order_materials (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references scm.production_orders(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  line_id uuid references scm.production_order_lines(id) on delete set null,
  item_code text not null,
  description text,
  uom text,
  qty_needed numeric(12,3) not null check (qty_needed > 0),
  qty_per_unit numeric(12,3),
  from_list boolean not null default false,
  qty_ordered numeric(12,3) not null default 0,
  qty_received numeric(12,3) not null default 0,
  unit_cost_sen integer not null default 0,
  received_cost_sen integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index production_order_materials_order_idx on scm.production_order_materials (production_order_id);
create index production_order_materials_item_idx on scm.production_order_materials (company_id, item_code);
create unique index production_order_materials_line_item on scm.production_order_materials (line_id, item_code) where line_id is not null;
alter table scm.production_order_materials owner to scm_engine;
alter table scm.production_order_materials enable row level security;
revoke all on scm.production_order_materials from anon, authenticated;
grant all on scm.production_order_materials to service_role, pos_app;

create table scm.production_material_lists (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  works_item_code text not null,
  raw_item_code text not null,
  qty_per_unit numeric(12,3) not null check (qty_per_unit > 0),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by bigint,
  unique (company_id, works_item_code, raw_item_code)
);
alter table scm.production_material_lists owner to scm_engine;
alter table scm.production_material_lists enable row level security;
revoke all on scm.production_material_lists from anon, authenticated;
grant all on scm.production_material_lists to service_role, pos_app;

alter table scm.purchase_order_items add column production_material_id uuid references scm.production_order_materials(id);
create index purchase_order_items_production_material_idx on scm.purchase_order_items (production_material_id) where production_material_id is not null;

-- Adds the list's materials for the given works lines (null: every line). A material already on a line stays as it is.
create function scm.production_apply_list(p_order uuid, p_lines uuid[]) returns integer
language plpgsql set search_path = scm, pg_temp as $$
declare added integer;
begin
  insert into scm.production_order_materials
    (production_order_id, company_id, line_id, item_code, description, uom, qty_needed, qty_per_unit, from_list)
  select l.production_order_id, l.company_id, l.id, b.raw_item_code, p.name, p.uom, l.qty * b.qty_per_unit, b.qty_per_unit, true
    from scm.production_order_lines l
    join scm.production_material_lists b on b.company_id = l.company_id and b.works_item_code = l.item_code
    left join scm.mfg_products p on p.company_id = l.company_id and p.code = b.raw_item_code
   where l.production_order_id = p_order and l.qty > 0 and (p_lines is null or l.id = any (p_lines))
  on conflict (line_id, item_code) where line_id is not null do nothing;
  get diagnostics added = row_count;
  return added;
end $$;

-- Links a PO raised for materials: the Nth material is line N of the PO. The project is the production order's.
create function scm.production_link_po(p_po uuid, p_materials uuid[], p_project bigint) returns void
language plpgsql set search_path = scm, pg_temp as $$
begin
  update scm.purchase_order_items i
     set production_material_id = x.m, uom = coalesce(i.uom, mm.uom), from_mrp = true
    from unnest(p_materials) with ordinality as x(m, ord)
    join scm.production_order_materials mm on mm.id = x.m
   where i.purchase_order_id = p_po and i.line_no = x.ord;
  if p_project is not null then
    update scm.purchase_orders set project_id = p_project where id = p_po and project_id is null;
  end if;
end $$;

-- What is on order and received for one material, from its live PO lines, and the order's actual cost: the received
-- raw-material cost at the PO line's net price (a received line's price is locked), labour coming later.
create function scm.production_refresh_material(p_material uuid) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare ordered numeric; received numeric; cost numeric; o uuid;
begin
  select coalesce(sum(i.qty), 0), coalesce(sum(coalesce(i.received_qty, 0)), 0),
         coalesce(sum(round(coalesce(i.received_qty, 0)::numeric * i.line_total_sen / nullif(i.qty, 0))), 0)
    into ordered, received, cost
    from scm.purchase_order_items i
    join scm.purchase_orders p on p.id = i.purchase_order_id
   where i.production_material_id = p_material and p.status::text <> 'CANCELLED';
  update scm.production_order_materials
     set qty_ordered = ordered, qty_received = received, received_cost_sen = cost,
         unit_cost_sen = case when received > 0 then round(cost / received) else unit_cost_sen end
   where id = p_material
  returning production_order_id into o;
  if o is not null then
    update scm.production_orders
       set actual_cost_sen = (select coalesce(sum(m.received_cost_sen), 0) from scm.production_order_materials m where m.production_order_id = o),
           updated_at = now()
     where id = o;
  end if;
end $$;

-- Brings the production order of a PO into line with that PO. Does nothing for a PO that is not INHOUSE's and never was.
create function scm.production_sync_po(p_po uuid) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare
  po record; pr record; is_inhouse boolean; live boolean; series text; used integer; n integer; new_lines uuid[];
begin
  select p.id, p.po_number, p.company_id, p.status::text as status, p.total_sen, p.expected_at, p.project_id,
         p.purchase_location_id, s.code as supplier_code
    into po
    from scm.purchase_orders p left join scm.suppliers s on s.id = p.supplier_id
   where p.id = p_po;
  if not found then return; end if;
  is_inhouse := po.supplier_code = 'INHOUSE';
  live := is_inhouse and po.status not in ('DRAFT', 'CANCELLED');
  select * into pr from scm.production_orders where source_po_id = p_po for update;

  if not found then
    if not live then return; end if;
    series := coalesce(substring(po.po_number from '^(.*)PO-'), '') || 'PRO-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYMM');
    select coalesce(max(substring(doc_no from '[0-9]+$')::integer), 0) into used
      from scm.production_orders where doc_no like series || '-%';
    n := scm.next_doc_no_n(series, used);
    insert into scm.production_orders (doc_no, company_id, source_po_id)
    values (series || '-' || lpad(n::text, 3, '0'), po.company_id, p_po)
    on conflict (source_po_id) do nothing;
    select * into pr from scm.production_orders where source_po_id = p_po for update;
  end if;

  if not live then
    if pr.status = 'CANCELLED' then return; end if;
    -- The owner's rule: it follows the PO while nothing has been ordered for it.
    if exists (select 1 from scm.production_order_materials m
                 join scm.purchase_order_items i on i.production_material_id = m.id
                 join scm.purchase_orders rp on rp.id = i.purchase_order_id
                where m.production_order_id = pr.id and rp.status::text <> 'CANCELLED') then
      raise exception 'Production order % has raw materials on order. Cancel those purchase orders first.', pr.doc_no
        using errcode = 'check_violation';
    end if;
    update scm.production_orders set status = 'CANCELLED', updated_at = now() where id = pr.id;
    return;
  end if;

  update scm.production_orders
     set amount_sen = coalesce(po.total_sen, 0),
         project_id = coalesce(po.project_id, project_id),
         warehouse_id = coalesce(po.purchase_location_id, warehouse_id),
         target_date = coalesce(target_date, po.expected_at),
         so_doc_no = (select min(i.doc_no) from scm.purchase_order_items x
                        join scm.mfg_sales_order_items i on i.id = x.so_item_id where x.purchase_order_id = p_po),
         status = case when status = 'CANCELLED' then 'PLANNED' else status end,
         updated_at = now()
   where id = pr.id;

  select array_agg(i.id) into new_lines
    from scm.purchase_order_items i
   where i.purchase_order_id = p_po
     and not exists (select 1 from scm.production_order_lines l where l.po_item_id = i.id);

  insert into scm.production_order_lines
    (production_order_id, company_id, po_item_id, so_item_id, line_no, item_code, description, room, qty, uom, unit_price_sen, line_total_sen)
  select pr.id, po.company_id, i.id, i.so_item_id, i.line_no, i.item_code, coalesce(i.description, i.material_name), i.room, i.qty, i.uom,
         coalesce(i.unit_price_sen, 0), coalesce(i.line_total_sen, 0)
    from scm.purchase_order_items i where i.purchase_order_id = p_po
  on conflict (po_item_id) do update
     set so_item_id = excluded.so_item_id, line_no = excluded.line_no, item_code = excluded.item_code,
         description = excluded.description, room = excluded.room, qty = excluded.qty, uom = excluded.uom,
         unit_price_sen = excluded.unit_price_sen, line_total_sen = excluded.line_total_sen;

  update scm.production_order_materials m set qty_needed = l.qty * m.qty_per_unit
    from scm.production_order_lines l
   where m.line_id = l.id and l.production_order_id = pr.id and m.from_list and l.qty > 0 and m.qty_needed <> l.qty * m.qty_per_unit;
  -- A works line that left the PO takes its list materials with it, unless they were bought.
  delete from scm.production_order_materials m
   where m.production_order_id = pr.id and m.line_id is null and m.from_list
     and not exists (select 1 from scm.purchase_order_items i where i.production_material_id = m.id);

  if new_lines is not null then
    select array_agg(l.id) into new_lines from scm.production_order_lines l where l.po_item_id = any (new_lines);
    perform scm.production_apply_list(pr.id, new_lines);
  end if;
end $$;

create function scm.production_po_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare m uuid;
begin
  perform scm.production_sync_po(new.id);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    for m in select distinct production_material_id from scm.purchase_order_items
              where purchase_order_id = new.id and production_material_id is not null loop
      perform scm.production_refresh_material(m);
    end loop;
  end if;
  return null;
end $$;

create function scm.production_po_item_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare po_id uuid; mat_new uuid; mat_old uuid;
begin
  if tg_op = 'DELETE' then po_id := old.purchase_order_id; mat_old := old.production_material_id;
  elsif tg_op = 'INSERT' then po_id := new.purchase_order_id; mat_new := new.production_material_id;
  else po_id := new.purchase_order_id; mat_new := new.production_material_id; mat_old := old.production_material_id; end if;
  perform scm.production_sync_po(po_id);
  if mat_new is not null then perform scm.production_refresh_material(mat_new); end if;
  if mat_old is not null and mat_old is distinct from mat_new then perform scm.production_refresh_material(mat_old); end if;
  return null;
end $$;

create trigger trg_production_po
  after insert or update of status, supplier_id, total_sen, expected_at, purchase_location_id, project_id on scm.purchase_orders
  for each row execute function scm.production_po_changed();
create trigger trg_production_po_item
  after insert or delete or update of qty, unit_price_sen, line_total_sen, item_code, description, room, uom, received_qty, production_material_id
  on scm.purchase_order_items
  for each row execute function scm.production_po_item_changed();

-- A PO to INHOUSE posts no payable: our own team is not billed or paid as a supplier, on any path.
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
