-- REVERSAL: drop trigger trg_po_date_to_production on scm.purchase_orders; drop function scm.po_date_to_production(); drop trigger trg_production_date_materials on scm.production_orders; drop function scm.production_date_materials(); set the LED-KNK SKUs back to category and group RAW, sub-category WIRE_FITTING.
-- Two owner decisions of 5 Nov 2026.
--   K & K's LED SKUs stay Lighting: they are sold on sales orders, unlike the rest of that price list (0222).
--   In-house orders are opened early with a future date, so their raw materials work as a schedule: when the order's
--   date moves, whether on the order or on the PO behind it, its composition materials move with it. A material already
--   on a live PO keeps its dates.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

update scm.mfg_products
   set category = 'LIGHTING', category_group = 'LIGHTING', sub_category = 'LED_STRIP'
 where code like 'LED-KNK-%';

create function scm.production_date_materials() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  update scm.production_order_materials m
     set processing_date = case when new.expected_at is null then null else greatest(today, new.expected_at - 7) end,
         delivery_date = case when new.expected_at is null then null else greatest(today, new.expected_at - 1) end,
         updated_at = now()
   where m.production_order_id = new.id and m.from_composition
     and not exists (select 1 from scm.purchase_order_items i join scm.purchase_orders po on po.id = i.purchase_order_id
                      where i.production_material_id = m.id and po.status::text <> 'CANCELLED');
  return null;
end $$;
alter function scm.production_date_materials() owner to scm_engine;

create trigger trg_production_date_materials after update of expected_at on scm.production_orders
  for each row when (old.expected_at is distinct from new.expected_at)
  execute function scm.production_date_materials();

create function scm.po_date_to_production() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  update scm.production_orders set expected_at = new.expected_at, updated_at = now()
   where source_po_id = new.id and expected_at is distinct from new.expected_at;
  return null;
end $$;
alter function scm.po_date_to_production() owner to scm_engine;

create trigger trg_po_date_to_production after update of expected_at on scm.purchase_orders
  for each row when (old.expected_at is distinct from new.expected_at)
  execute function scm.po_date_to_production();
