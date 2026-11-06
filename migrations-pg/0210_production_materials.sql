-- REVERSAL: refused while a material is on a PO. alter table scm.purchase_order_items drop column production_material_id; drop table scm.production_order_materials; alter table scm.production_orders drop column production_time_days; drop function scm.production_link_po(uuid, uuid[], bigint);
-- What a production order needs (owner, 4 Nov 2026): the raw materials it uses, each with a processing date (when to
-- order) and a delivery date, and how long he expects the job to take.
--
--   production_orders.production_time_days   his estimate, in days. A plain field: it moves no date. Days and not the
--                                            product's production_time_minutes, which is a Houzs leftover that no
--                                            screen shows and no SKU has set.
--   production_order_materials               one row per material. MRP reads them as demand; what they have on order
--                                            and received is read live from the PO lines below, never stored.
--   purchase_order_items.production_material_id
--                                            the raw-material PO line that buys a material. On the PO line so several
--                                            POs can buy one material, and a cancelled PO stops counting by itself.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, select demo.drop_views() first and
-- select demo.sync() last; staging first, then production, BEFORE the code that needs it merges.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.production_orders
  add column production_time_days numeric(6,1) check (production_time_days is null or production_time_days >= 0);

create table scm.production_order_materials (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references scm.production_orders(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  item_code text not null,
  description text,
  uom text,
  qty_needed numeric(12,3) not null check (qty_needed > 0),
  processing_date date,
  delivery_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by bigint
);
create index production_order_materials_order_idx on scm.production_order_materials (production_order_id);
create index production_order_materials_item_idx on scm.production_order_materials (company_id, item_code);
alter table scm.production_order_materials owner to scm_engine;
alter table scm.production_order_materials enable row level security;
revoke all on scm.production_order_materials from anon, authenticated;
grant all on scm.production_order_materials to service_role, pos_app;

alter table scm.purchase_order_items add column production_material_id uuid references scm.production_order_materials(id);
create index purchase_order_items_production_material_idx on scm.purchase_order_items (production_material_id) where production_material_id is not null;

-- Links a PO raised for materials: the Nth material is line N of the PO. One call, so the request stays small.
create function scm.production_link_po(p_po uuid, p_materials uuid[], p_project bigint) returns void
language plpgsql set search_path = scm, pg_temp as $$
begin
  update scm.purchase_order_items i
     set production_material_id = x.m, uom = coalesce(mm.uom, i.uom), from_mrp = true
    from unnest(p_materials) with ordinality as x(m, ord)
    join scm.production_order_materials mm on mm.id = x.m
   where i.purchase_order_id = p_po and i.line_no = x.ord;
  if p_project is not null then
    update scm.purchase_orders set project_id = p_project where id = p_po and project_id is null;
  end if;
end $$;

notify pgrst, 'reload schema';
