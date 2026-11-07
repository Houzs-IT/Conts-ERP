-- REVERSAL: drop trigger trg_production_item_share_basis on scm.production_order_items; drop function scm.production_item_share_basis(); drop function scm.production_line_shares(bigint, text, uuid, numeric, numeric); restore scm.production_line_shares(bigint, text, uuid, numeric) and scm.production_bump_material() from 0240 and scm.production_item_materials() from 0246; alter table scm.production_order_items drop column share_so_qty.
-- A VO that removes a line after Start deleted its material with stock still out, so that stock could never go back. A
-- material now stays while any of it is out, at what is out, so Return stock has a row to work on.
-- The VO changes the SO line first and the PO change lands later, so a saved list's old share was worked out on the new SO
-- qty and took off too much. production_order_items.share_so_qty keeps the SO qty the line's share was last worked out on.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.production_order_items add column if not exists share_so_qty numeric;
update scm.production_order_items i set share_so_qty = nullif(s.qty, 0)::numeric
  from scm.mfg_sales_order_items s where s.id = i.so_item_id and i.share_so_qty is null;

create function scm.production_line_shares(p_company bigint, p_sku text, p_so_item uuid, p_qty numeric, p_so_qty numeric)
returns table (material_code text, qty numeric)
language sql stable set search_path = scm, pg_temp as $$
  with line as (
    select coalesce((select p.materials_saved from scm.reno_beta_line_plans p where p.so_item_id = p_so_item), false) as saved,
           exists (select 1 from scm.reno_doc_lines d where d.so_item_id = p_so_item and d.measure is not null) as measured
  )
  select s.material_code, round(s.qty * case when line.measured then sign(p_qty) else p_qty / coalesce(p_so_qty, abs(p_qty)) end, 3)
    from line join scm.so_line_materials s on s.so_item_id = p_so_item
   where line.saved
  union all
  select c.material_code, round(c.qty * scm.production_line_units(p_so_item, p_qty), 3)
    from line join scm.sku_compositions c on c.company_id = p_company and c.sku_code = p_sku
   where not line.saved
$$;
alter function scm.production_line_shares(bigint, text, uuid, numeric, numeric) owner to scm_engine;

create or replace function scm.production_line_shares(p_company bigint, p_sku text, p_so_item uuid, p_qty numeric)
returns table (material_code text, qty numeric)
language sql stable set search_path = scm, pg_temp as $$
  select * from scm.production_line_shares(p_company, p_sku, p_so_item, p_qty,
    (select nullif(i.qty, 0)::numeric from scm.mfg_sales_order_items i where i.id = p_so_item))
$$;

create or replace function scm.production_bump_material(p_order uuid, p_company bigint, p_material text, p_delta numeric) returns void
language plpgsql set search_path = scm, pg_temp as $$
declare
  row_id uuid; left_over numeric; still_out integer; due date; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  if p_delta = 0 then return; end if;
  select m.id, m.qty_needed + p_delta, m.qty_issued - m.qty_returned into row_id, left_over, still_out from scm.production_order_materials m
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
  elsif still_out > 0 then
    update scm.production_order_materials set qty_needed = still_out, updated_at = now() where id = row_id;
  elsif not exists (select 1 from scm.purchase_order_items i where i.production_material_id = row_id) then
    delete from scm.production_order_materials where id = row_id;
  end if;
end $$;

/* Before the row is saved, so the same save carries the SO qty its new share is worked out on. */
create function scm.production_item_share_basis() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  if tg_op = 'INSERT' or old.qty is distinct from new.qty or old.item_code is distinct from new.item_code or old.so_item_id is distinct from new.so_item_id then
    new.share_so_qty := (select nullif(i.qty, 0)::numeric from scm.mfg_sales_order_items i where i.id = new.so_item_id);
  end if;
  return new;
end $$;
alter function scm.production_item_share_basis() owner to scm_engine;
create trigger trg_production_item_share_basis before insert or update of qty, item_code, so_item_id on scm.production_order_items
  for each row execute function scm.production_item_share_basis();

create or replace function scm.production_item_materials() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare m record;
begin
  for m in
    select x.material_code, sum(x.qty) as qty
      from (
        select s.material_code, s.qty from scm.production_line_shares(old.company_id, old.item_code, old.so_item_id, -old.qty, old.share_so_qty) s where tg_op <> 'INSERT'
        union all
        select s.material_code, s.qty from scm.production_line_shares(new.company_id, new.item_code, new.so_item_id, new.qty, new.share_so_qty) s where tg_op <> 'DELETE'
      ) x
     group by x.material_code
    having sum(x.qty) <> 0
  loop
    perform scm.production_bump_material(coalesce(new.production_order_id, old.production_order_id), coalesce(new.company_id, old.company_id), m.material_code, m.qty);
  end loop;
  return null;
end $$;

select demo.sync();
