-- REVERSAL: drop trigger trg_production_item_materials on scm.production_order_items; drop function scm.production_item_materials(); alter table scm.production_order_materials drop column from_composition; alter table scm.reno_beta_line_plans drop column materials_saved; drop table scm.so_line_materials, scm.sku_compositions;
-- Raw materials from the SKU to the production order (owner, 5 Nov 2026).
--   sku_compositions   Production > SKU Composition: what one unit of a SKU uses.
--   so_line_materials  a project's SO line once its list was edited (reno_beta_line_plans.materials_saved). Until then the
--                      line uses the composition times its qty, so a changed composition reaches lines nobody touched.
--   A production order's line brings those materials with it, by a trigger because every PO to INHOUSE reaches the
--   order through scm.production_sync_po. Order 7 days and arrive 1 day before the order's date; a date already past
--   becomes today, so a late order can read "order today, arrive today". One row per material on an order.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create table scm.sku_compositions (
  id uuid primary key default gen_random_uuid(),
  company_id bigint not null references public.companies(id),
  sku_code text not null,
  material_code text not null,
  qty numeric(12,3) not null check (qty > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by bigint,
  unique (company_id, sku_code, material_code),
  check (sku_code <> material_code)
);
alter table scm.sku_compositions owner to scm_engine;
alter table scm.sku_compositions enable row level security;
revoke all on scm.sku_compositions from anon, authenticated;
grant all on scm.sku_compositions to service_role, pos_app;

create table scm.so_line_materials (
  id uuid primary key default gen_random_uuid(),
  so_item_id uuid not null references scm.mfg_sales_order_items(id) on delete cascade,
  company_id bigint not null references public.companies(id),
  material_code text not null,
  qty numeric(12,3) not null check (qty > 0),
  updated_at timestamptz not null default now(),
  updated_by bigint,
  unique (so_item_id, material_code)
);
alter table scm.so_line_materials owner to scm_engine;
alter table scm.so_line_materials enable row level security;
revoke all on scm.so_line_materials from anon, authenticated;
grant all on scm.so_line_materials to service_role, pos_app;

alter table scm.reno_beta_line_plans add column materials_saved boolean not null default false;
alter table scm.production_order_materials add column from_composition boolean not null default false;

create function scm.production_item_materials() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare
  due date; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; saved boolean; m record;
begin
  select coalesce(o.expected_at, new.delivery_date) into due from scm.production_orders o where o.id = new.production_order_id;
  select coalesce(p.materials_saved, false) into saved from scm.reno_beta_line_plans p where p.so_item_id = new.so_item_id;
  for m in
    select s.material_code, s.qty from scm.so_line_materials s where coalesce(saved, false) and s.so_item_id = new.so_item_id
    union all
    select c.material_code, round(c.qty * new.qty, 3) from scm.sku_compositions c
     where not coalesce(saved, false) and c.company_id = new.company_id and c.sku_code = new.item_code
  loop
    update scm.production_order_materials set qty_needed = qty_needed + m.qty, updated_at = now()
     where production_order_id = new.production_order_id and item_code = m.material_code and from_composition;
    if not found then
      insert into scm.production_order_materials
        (production_order_id, company_id, item_code, description, uom, qty_needed, processing_date, delivery_date, from_composition)
      select new.production_order_id, new.company_id, m.material_code, p.name, p.uom, m.qty,
             greatest(today, due - 7), greatest(today, due - 1), true
        from (select 1) one
        left join lateral (select name, uom from scm.mfg_products where code = m.material_code and company_id = new.company_id limit 1) p on true;
    end if;
  end loop;
  return null;
end $$;
alter function scm.production_item_materials() owner to scm_engine;

create trigger trg_production_item_materials after insert on scm.production_order_items
  for each row execute function scm.production_item_materials();

notify pgrst, 'reload schema';
