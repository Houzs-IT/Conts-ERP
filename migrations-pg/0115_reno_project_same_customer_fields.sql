-- REVERSAL: alter table scm.mfg_sales_orders drop column attachments; alter table public.projects drop column salesperson_staff_id, drop column address1, drop column address2, drop column city, drop column postcode, drop column country, drop column sales_location;
-- The project asks for exactly what the renovation sales order asks for (owner, 14 Oct 2026): the same Customer,
-- Delivery address and Order information fields, in the same order, with the same required rules.
--
-- * projects.salesperson_staff_id: the salesperson, the same employee (scm.staff) the sales order's salesperson_id
--   names. projects.salesperson_name stays filled with that person's name for whatever still reads it.
-- * projects.address1 / address2 / city / state / postcode / country / sales_location: the delivery address the
--   way the sales order stores it (address1, address2, city, customer_state, postcode, customer_country,
--   sales_location). The state goes in projects.state, the column an exhibition project already has for its venue's
--   state; on a renovation project it is the delivery address's state. projects.site_address stays filled (the
--   address joined) for whatever still reads it; this migration fills address1 from its first line and address2
--   from the rest.
-- * The two-way rule that keeps the SO and its project equal is engine/backend/src/scm/shared/renovation-property.ts.
-- * scm.mfg_sales_orders.attachments: files attached to the whole order (owner, 14 Oct 2026: photos of the site,
--   floor plans, the signed quotation), a JSON list of {id, key, name, type, size, at, by}. The files live in the
--   bucket the line photos already use (SO_ITEM_PHOTOS, under so-attachments/<doc no>/).
--
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).
-- Until it is applied the project keeps its single site address and no salesperson (the engine reads these
-- columns only once they exist).
set local search_path = public, extensions;

alter table public.projects
  add column salesperson_staff_id uuid references scm.staff(id) on delete set null,
  add column address1 text,
  add column address2 text,
  add column city text,
  add column postcode text,
  add column country text,
  add column sales_location text;

update public.projects
   set address1 = nullif(trim(split_part(site_address, E'\n', 1)), ''),
       address2 = nullif(trim(regexp_replace(substr(site_address, length(split_part(site_address, E'\n', 1)) + 2), '\s*\n\s*', ', ', 'g')), '')
 where site_address is not null and trim(site_address) <> '' and address1 is null;

alter table scm.mfg_sales_orders
  add column attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array');
