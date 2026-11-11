-- REVERSAL: drop trigger if exists trg_so_item_delete_floor on scm.mfg_sales_order_items; drop function if exists scm.fn_so_item_delete_floor();
-- Purely a guard: it writes no row, so dropping it changes no stored data.
-- An SO line a live delivery order ships cannot be deleted (Houzs 127f66943, part A of its 20261029T1000). The app already
-- refuses a carried line before it deletes (readSoLineFreeze); this is the backstop for a DO confirmed after that read and
-- before the delete. delivery_order_items.so_item_id is ON DELETE SET NULL, so without it the DO would end up shipping
-- against no SO line at all. A DRAFT or CANCELLED DO line does not block. The DR-cancel half of the Houzs migration needs
-- an over-delivery cap function Conts never received, so that check is done in the app (lib/dr-cancel-cap.ts).
-- Renovation contracts never delete SO lines (a VO marks them cancelled), so this does not touch the renovation flow.
set local lock_timeout = '5s';

create or replace function scm.fn_so_item_delete_floor() returns trigger
language plpgsql security definer set search_path = scm, public as $$
begin
  -- The lock the DO side takes on the line, so whichever of delete and DO-confirm comes second sees the first.
  perform 1 from scm.mfg_sales_order_items s where s.id = old.id for no key update;
  if not found then
    return old;
  end if;
  if exists (
    select 1 from scm.delivery_order_items i join scm.delivery_orders d on d.id = i.delivery_order_id
     where i.so_item_id = old.id and upper(d.status::text) not in ('DRAFT', 'CANCELLED')
  ) then
    raise exception using
      errcode = 'P0409',
      message = format('so_line_over_delivered: SO line %s is carried by a live delivery order and cannot be deleted', old.id),
      detail = old.id::text,
      hint = 'A Delivery Order already ships this Sales Order line. Refresh and check the order.';
  end if;
  return old;
end $$;

drop trigger if exists trg_so_item_delete_floor on scm.mfg_sales_order_items;
create trigger trg_so_item_delete_floor before delete on scm.mfg_sales_order_items
  for each row execute function scm.fn_so_item_delete_floor();
