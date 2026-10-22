-- REVERSAL: delete from scm.product_sub_categories where code = 'EYEBALL' (refused while a SKU uses it); run the same steps back with WORKS for SERVICE: move scm.mfg_products / scm.product_models RN-AIRCON_INSTALL, RN-CLEANING, RN-PROJECT_MGMT (and any SKU of the three sub-categories) to category WORKS with their sub_category nulled, set scm.product_sub_categories group_code = 'WORKS' and sort_order 110/120/130 for AIRCON_INSTALL/CLEANING/PROJECT_MGMT, then put the sub_category back on those SKUs; rename the RN- SKUs and models 'Works - <label>'; move purchase_order_items / purchase_orders / grn_items of the three back to category_group 'WORKS'; move public.project_procurement_dates rows of the three back to group_code 'WORKS' (rows this migration inserted carry updated_by 'migration 0141' and can be deleted).
-- Aircon install, Cleaning and Project management belong under Service, not Works (owner, 22 Oct 2026).
-- Same day: a new Lighting sub-category, Eye ball (EYEBALL), after Downlight (end of this file).
--
-- Only the filing moves. They still act as site trades (renovation-catalog.ts SITE_TRADE_SERVICES): an SO line
-- of these sub-categories makes the same site task (aircon install in hardware, cleaning in handover, project
-- management none), keeps the hardware stage alive, keeps the same home stage and still gets a PO when the owner
-- supplies the goods. Codes and labels do not change, so trade tasks, task categories and SO lines (which store
-- the code) are untouched.
--
-- * scm.product_sub_categories: group_code WORKS -> SERVICE, sorted after the existing Service ones (50, 60, 70).
--   The key is (group_code, code) and scm.mfg_products references it, so the SKUs leave the old pair first
--   (sub_category nulled, allowed for SERVICE) and take the code back after the row has moved.
-- * SKUs: every scm.mfg_products row of the three in WORKS moves to category SERVICE (the trigger re-derives
--   category_group), with its model (scm.product_models, so model and SKUs agree as moveModelCategory keeps them).
--   The generic RN- SKUs and their models are renamed "Service - <label>" to match genericSkus().
-- * Order lines keep the item_group they were written with (as for any category move, model-category-move.ts).
-- * Renovation PO / GR stamps (migration 0116): a project PO holds one category, so a PO whose every categorised
--   line is one of the three moves to SERVICE with its lines and their GR lines; a PO that mixes them with other
--   Works trades stays WORKS whole. On production on 22 Oct 2026 no PO or GR line carried the three.
-- * public.project_procurement_dates: a project's dates for the three move to SERVICE. Where a sub-category
--   followed the Works dates (a 'follow' row, or no row), it gets those dates as its own, so its effective PO and
--   delivery dates do not change when it starts following Service instead.
set local search_path = scm, public, extensions;

create temp table mig0141_subs (code text primary key, sort_order integer not null, label text not null) on commit drop;
insert into mig0141_subs (code, sort_order, label) values
  ('AIRCON_INSTALL', 50, 'Aircon install'),
  ('CLEANING', 60, 'Cleaning'),
  ('PROJECT_MGMT', 70, 'Project management');

-- 1. Procurement dates: keep each project's effective dates for the three.
update public.project_procurement_dates d
   set mode = 'own', po_date = c.po_date, delivery_date = c.delivery_date, updated_at = now(), updated_by = 'migration 0141'
  from public.project_procurement_dates c
 where d.group_code = 'WORKS' and d.sub_code in (select code from mig0141_subs) and d.mode = 'follow'
   and c.project_id = d.project_id and c.group_code = 'WORKS' and c.sub_code = ''
   and (c.po_date is not null or c.delivery_date is not null);

update public.project_procurement_dates d
   set group_code = 'SERVICE'
 where d.group_code = 'WORKS' and d.sub_code in (select code from mig0141_subs)
   and not exists (select 1 from public.project_procurement_dates x
                    where x.project_id = d.project_id and x.group_code = 'SERVICE' and x.sub_code = d.sub_code);

insert into public.project_procurement_dates (project_id, group_code, sub_code, po_date, delivery_date, mode, updated_by)
select c.project_id, 'SERVICE', s.code, c.po_date, c.delivery_date, 'own', 'migration 0141'
  from public.project_procurement_dates c
  cross join mig0141_subs s
 where c.group_code = 'WORKS' and c.sub_code = '' and (c.po_date is not null or c.delivery_date is not null)
on conflict (project_id, group_code, sub_code) do nothing;

-- 2. Models and SKUs leave the (WORKS, sub) pair.
create temp table mig0141_skus on commit drop as
select p.id, p.sub_category, p.model_id from scm.mfg_products p
 where p.category_group = 'WORKS' and p.sub_category in (select code from mig0141_subs);

update scm.product_models m
   set category = 'SERVICE',
       name = case when m.name = 'Works - ' || s.label then 'Service - ' || s.label else m.name end
  from mig0141_skus k
  join mig0141_subs s on s.code = k.sub_category
 where m.id = k.model_id and m.category::text = 'WORKS';

update scm.mfg_products p
   set category = 'SERVICE',
       name = case when p.name = 'Works - ' || s.label then 'Service - ' || s.label else p.name end,
       updated_at = now()
  from mig0141_skus k
  join mig0141_subs s on s.code = k.sub_category
 where p.id = k.id;

-- 3. The sub-categories move.
update scm.product_sub_categories c
   set group_code = 'SERVICE', sort_order = s.sort_order
  from mig0141_subs s
 where c.code = s.code and c.group_code = 'WORKS';

-- 4. The SKUs take their code back (category unchanged, so the trigger keeps it).
update scm.mfg_products p
   set sub_category = k.sub_category
  from mig0141_skus k
 where p.id = k.id;

-- 5. Renovation PO / GR stamps, whole POs only.
create temp table mig0141_pos on commit drop as
select x.purchase_order_id as id from scm.purchase_order_items x
 where x.category_group is not null
 group by x.purchase_order_id
having bool_and(x.category_group = 'WORKS' and x.sub_category in (select code from mig0141_subs));

update scm.purchase_order_items x set category_group = 'SERVICE'
 where x.purchase_order_id in (select id from mig0141_pos) and x.category_group = 'WORKS';

update scm.purchase_orders po set category_group = 'SERVICE'
 where po.id in (select id from mig0141_pos) and po.category_group = 'WORKS';

update scm.grn_items g set category_group = 'SERVICE'
 where g.category_group = 'WORKS' and g.sub_category in (select code from mig0141_subs)
   and g.purchase_order_item_id in (select x.id from scm.purchase_order_items x where x.purchase_order_id in (select id from mig0141_pos));

-- Fail closed: nothing of the three may be left under WORKS in the catalog or on a SKU.
do $$
declare n integer;
begin
  select count(*) into n from scm.product_sub_categories where group_code = 'WORKS' and code in ('AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT');
  if n > 0 then raise exception '% sub-categories are still under WORKS', n; end if;
  select count(*) into n from scm.mfg_products where category_group = 'WORKS' and sub_category in ('AIRCON_INSTALL', 'CLEANING', 'PROJECT_MGMT');
  if n > 0 then raise exception '% SKUs of the three are still WORKS', n; end if;
  select count(*) into n from scm.mfg_products p join mig0141_skus k on k.id = p.id where p.sub_category is distinct from k.sub_category;
  if n > 0 then raise exception '% moved SKUs lost their sub-category', n; end if;
end $$;

-- Eye ball downlights, a Lighting sub-category of their own (owner, 22 Oct 2026), after Downlight.
insert into scm.product_sub_categories (group_code, code, label, sort_order, legacy_categories) values
  ('LIGHTING', 'EYEBALL', 'Eye ball', 15, '{}'::text[])
on conflict do nothing;
