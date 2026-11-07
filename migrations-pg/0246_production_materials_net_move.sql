-- REVERSAL: drop trigger trg_production_item_materials_edit on scm.production_order_items; drop trigger trg_production_item_materials on scm.production_order_items; create trigger trg_production_item_materials after insert or delete or update of qty on scm.production_order_items for each row execute function scm.production_item_materials(); then restore scm.production_item_materials() from 0240.
-- Any save of a production line wrote qty, so a note or a date took the line's whole share off its materials and added it
-- back. A material left at nothing on the way was deleted and made again with nothing issued, so Complete issued its stock
-- twice and Reopen could not bring it back; one a PO held doubled instead. A line now moves its materials once, by the net
-- difference, and an edit that changes neither qty, SKU nor SO line moves nothing.
select demo.drop_views();
set local lock_timeout = '5s';

create or replace function scm.production_item_materials() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare m record;
begin
  for m in
    select x.material_code, sum(x.qty) as qty
      from (
        select s.material_code, s.qty from scm.production_line_shares(old.company_id, old.item_code, old.so_item_id, -old.qty) s where tg_op <> 'INSERT'
        union all
        select s.material_code, s.qty from scm.production_line_shares(new.company_id, new.item_code, new.so_item_id, new.qty) s where tg_op <> 'DELETE'
      ) x
     group by x.material_code
    having sum(x.qty) <> 0
  loop
    perform scm.production_bump_material(coalesce(new.production_order_id, old.production_order_id), coalesce(new.company_id, old.company_id), m.material_code, m.qty);
  end loop;
  return null;
end $$;

-- Two triggers, because a WHEN naming old and new cannot sit on one that also fires for insert or delete.
drop trigger trg_production_item_materials on scm.production_order_items;
create trigger trg_production_item_materials after insert or delete on scm.production_order_items
  for each row execute function scm.production_item_materials();
create trigger trg_production_item_materials_edit after update of qty, item_code, so_item_id on scm.production_order_items
  for each row when (old.qty is distinct from new.qty or old.item_code is distinct from new.item_code or old.so_item_id is distinct from new.so_item_id)
  execute function scm.production_item_materials();

select demo.sync();
