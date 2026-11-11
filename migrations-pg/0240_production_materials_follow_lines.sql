-- REVERSAL: drop trigger trg_sku_composition_materials on scm.sku_compositions; drop function scm.production_composition_changed(); drop trigger trg_production_item_materials on scm.production_order_items; create trigger trg_production_item_materials after insert on scm.production_order_items for each row execute function scm.production_item_materials(); then restore scm.production_item_materials() from 0223; drop function scm.production_bump_material(uuid, bigint, text, numeric); drop function scm.production_line_units(uuid, numeric); drop function scm.production_line_shares(bigint, text, uuid, numeric);
-- A production order's raw materials were copied once, when its line landed (0223). So a later qty change or deleted line
-- never reached them, a saved list was added whole for every partial PO of the same SO line, and a measured line (one PO
-- unit standing for, say, 42.6 ft) asked for one unit of each material. Now every change to a line moves the materials by
-- the difference, so a quantity typed by hand on the order stays, and a composition edit reaches orders not yet started.
-- A material left at nothing goes, unless a PO already holds it. to_jsonb reads actual_start_at (0236) so this applies in
-- either order.
select demo.drop_views();
set local lock_timeout = '5s';

/* A line's units for a composition: its measure when measured, else its qty. */
create function scm.production_line_units(p_so_item uuid, p_qty numeric) returns numeric
language sql stable set search_path = scm, pg_temp as $$
  select coalesce((select d.measure * p_qty from scm.reno_doc_lines d where d.so_item_id = p_so_item and d.measure is not null limit 1), p_qty)
$$;
alter function scm.production_line_units(uuid, numeric) owner to scm_engine;

/* What this much of a line needs. A saved list covers the whole SO line, so a partial PO takes its share of it. */
create function scm.production_line_shares(p_company bigint, p_sku text, p_so_item uuid, p_qty numeric)
returns table (material_code text, qty numeric)
language sql stable set search_path = scm, pg_temp as $$
  with line as (
    select coalesce((select p.materials_saved from scm.reno_beta_line_plans p where p.so_item_id = p_so_item), false) as saved,
           (select nullif(i.qty, 0)::numeric from scm.mfg_sales_order_items i where i.id = p_so_item) as so_qty,
           exists (select 1 from scm.reno_doc_lines d where d.so_item_id = p_so_item and d.measure is not null) as measured
  )
  select s.material_code, round(s.qty * case when line.measured then sign(p_qty) else p_qty / coalesce(line.so_qty, abs(p_qty)) end, 3)
    from line join scm.so_line_materials s on s.so_item_id = p_so_item
   where line.saved
  union all
  select c.material_code, round(c.qty * scm.production_line_units(p_so_item, p_qty), 3)
    from line join scm.sku_compositions c on c.company_id = p_company and c.sku_code = p_sku
   where not line.saved
$$;
alter function scm.production_line_shares(bigint, text, uuid, numeric) owner to scm_engine;

create function scm.production_bump_material(p_order uuid, p_company bigint, p_material text, p_delta numeric) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare
  row_id uuid; left_over numeric; due date; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if p_delta = 0 then return; end if;
  select m.id, m.qty_needed + p_delta into row_id, left_over from scm.production_order_materials m
   where m.production_order_id = p_order and m.item_code = p_material and m.from_composition limit 1 for update;
  if row_id is null then
    if p_delta < 0 then return; end if;
    select o.expected_at into due from scm.production_orders o where o.id = p_order;
    if not found then return; end if;
    insert into scm.production_order_materials
      (production_order_id, company_id, item_code, description, uom, qty_needed, processing_date, delivery_date, from_composition)
    select p_order, p_company, p_material, p.name, p.uom, p_delta, greatest(today, due - 7), greatest(today, due - 1), true
      from (select 1) one
      left join lateral (select name, uom from scm.mfg_products where code = p_material and company_id = p_company limit 1) p on true;
    return;
  end if;
  if left_over > 0 then
    update scm.production_order_materials set qty_needed = left_over, updated_at = now() where id = row_id;
  elsif not exists (select 1 from scm.purchase_order_items i where i.production_material_id = row_id) then
    delete from scm.production_order_materials where id = row_id;
  end if;
end $$;
alter function scm.production_bump_material(uuid, bigint, text, numeric) owner to scm_engine;

create or replace function scm.production_item_materials() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare m record;
begin
  if tg_op <> 'INSERT' then
    for m in select * from scm.production_line_shares(old.company_id, old.item_code, old.so_item_id, -old.qty) loop
      perform scm.production_bump_material(old.production_order_id, old.company_id, m.material_code, m.qty);
    end loop;
  end if;
  if tg_op <> 'DELETE' then
    for m in select * from scm.production_line_shares(new.company_id, new.item_code, new.so_item_id, new.qty) loop
      perform scm.production_bump_material(new.production_order_id, new.company_id, m.material_code, m.qty);
    end loop;
  end if;
  return null;
end $$;

drop trigger trg_production_item_materials on scm.production_order_items;
create trigger trg_production_item_materials after insert or delete or update of qty on scm.production_order_items
  for each row execute function scm.production_item_materials();

/* A changed composition reaches open orders nobody has started, on lines that use it. */
create function scm.production_composition_changed() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare l record;
begin
  for l in
    select i.production_order_id, i.so_item_id, i.qty, i.company_id
      from scm.production_order_items i
      join scm.production_orders o on o.id = i.production_order_id
     where i.company_id = coalesce(new.company_id, old.company_id) and i.item_code = coalesce(new.sku_code, old.sku_code)
       and o.status::text = 'SUBMITTED' and to_jsonb(o) ->> 'actual_start_at' is null
       and not coalesce((select p.materials_saved from scm.reno_beta_line_plans p where p.so_item_id = i.so_item_id), false)
  loop
    if tg_op <> 'INSERT' then
      perform scm.production_bump_material(l.production_order_id, l.company_id, old.material_code, -round(old.qty * scm.production_line_units(l.so_item_id, l.qty), 3));
    end if;
    if tg_op <> 'DELETE' then
      perform scm.production_bump_material(l.production_order_id, l.company_id, new.material_code, round(new.qty * scm.production_line_units(l.so_item_id, l.qty), 3));
    end if;
  end loop;
  return null;
end $$;
alter function scm.production_composition_changed() owner to scm_engine;

create trigger trg_sku_composition_materials after insert or delete or update of qty, material_code on scm.sku_compositions
  for each row execute function scm.production_composition_changed();

select demo.sync();
