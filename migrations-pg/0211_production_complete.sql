-- REVERSAL: drop trigger trg_production_po_item_photos on scm.purchase_order_items; drop function scm.production_po_item_photos(); alter table scm.production_orders drop column completion_grn_id, drop column completion_do_id, drop column completion_step, drop column completion_error, drop column completion_lock_at;
-- Completing a production order (owner, 4 Nov 2026): it receives its PO on a real GRN and delivers its SO lines on a real
-- DO, through the code paths those documents always use. The steps run as separate requests (a request may make 50
-- outside calls on the Workers free plan), so the order remembers what it raised and a retry raises nothing twice.
--
--   completion_grn_id, completion_do_id   the documents it raised. Their progress photos show on them as proof of
--                                         receipt and proof of delivery, read from the order, so nothing is copied.
--   completion_step                       the last step finished: grn, do, done. Null before Complete.
--   completion_error                      why a step stopped, in words, until a retry clears it.
--   completion_lock_at                    a step in flight, so two presses cannot both run it.
--
-- A PO line's photos follow it onto the production order line: photo_urls names the same files.
--
-- APPLY: by hand, in one transaction with its public.pos_migrations row, select demo.drop_views() first and
-- select demo.sync() last; staging first, then production, BEFORE the code that needs it merges.
set local search_path = scm, public, extensions;
set local lock_timeout = '5s';

alter table scm.production_orders
  add column completion_grn_id uuid,
  add column completion_do_id uuid,
  add column completion_step text check (completion_step is null or completion_step in ('grn', 'do', 'done')),
  add column completion_error text,
  add column completion_lock_at timestamptz;
create index production_orders_completion_grn_idx on scm.production_orders (completion_grn_id) where completion_grn_id is not null;
create index production_orders_completion_do_idx on scm.production_orders (completion_do_id) where completion_do_id is not null;

create function scm.production_po_item_photos() returns trigger
language plpgsql set search_path = scm, pg_temp as $$
begin
  update scm.production_order_items set photo_urls = new.photo_urls where source_po_item_id = new.id;
  return null;
end $$;
create trigger trg_production_po_item_photos
  after update of photo_urls on scm.purchase_order_items
  for each row when (old.photo_urls is distinct from new.photo_urls)
  execute function scm.production_po_item_photos();

notify pgrst, 'reload schema';
