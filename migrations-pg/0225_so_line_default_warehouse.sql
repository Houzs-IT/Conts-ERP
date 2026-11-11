-- REVERSAL: drop trigger trg_so_item_default_warehouse on scm.mfg_sales_order_items; drop function scm.so_item_default_warehouse();
-- Where a new sales line defaults to (owner, 5 Nov 2026): Works and Built-in to On-site, everything else to the default
-- warehouse. Only a line with no warehouse, or the default one, is touched; it is a default, so it can still be changed.
-- A trigger because lines are written from the SO, the contract, VOs and the delivery rebuild. Existing lines stay.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

create function scm.so_item_default_warehouse() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
declare
  fallback uuid; onsite uuid; cat text;
begin
  select id into fallback from scm.warehouses where company_id = new.company_id and is_default limit 1;
  if new.warehouse_id is not null and new.warehouse_id is distinct from fallback then return new; end if;
  select category::text into cat from scm.mfg_products where code = new.item_code and company_id = new.company_id limit 1;
  if cat in ('WORKS', 'BUILTIN') then
    select id into onsite from scm.warehouses where company_id = new.company_id and code = 'ONSITE' limit 1;
  end if;
  new.warehouse_id := coalesce(onsite, new.warehouse_id, fallback);
  return new;
end $$;
alter function scm.so_item_default_warehouse() owner to scm_engine;

create trigger trg_so_item_default_warehouse before insert on scm.mfg_sales_order_items
  for each row execute function scm.so_item_default_warehouse();
