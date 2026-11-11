-- REVERSAL: alter table public.projects drop column land_area_sqft, drop column land_size; alter table scm.mfg_sales_orders drop column land_area_sqft, drop column land_size;
-- A landed property also records its land (owner, 5 Nov 2026): the area in square feet and the size as measured, like "22 x 75".
-- Shared by the project and its sales order, the same two-way rule as the built-up area.
set local lock_timeout = '5s';

alter table public.projects
  add column if not exists land_area_sqft numeric(12, 2),
  add column if not exists land_size text;

alter table scm.mfg_sales_orders
  add column if not exists land_area_sqft numeric(12, 2),
  add column if not exists land_size text;
