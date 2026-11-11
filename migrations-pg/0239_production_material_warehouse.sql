-- REVERSAL: alter table scm.production_order_materials drop column warehouse_id;
-- Choosing where one raw material is delivered, on the MRP page, rewrote the whole production order's location and so
-- moved the order's other materials. Each material now holds its own pick; blank means the order's location.
select demo.drop_views();
set local lock_timeout = '5s';

alter table scm.production_order_materials
  add column if not exists warehouse_id uuid references scm.warehouses(id) on delete set null;

select demo.sync();
