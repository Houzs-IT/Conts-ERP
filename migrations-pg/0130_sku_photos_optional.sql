-- REVERSAL: update scm.product_category_groups set photo_required = true where code in ('BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT'); re-run the function and trigger blocks of 0062_mfg_product_photos.sql (create function scm.mfg_products_photo_gate ... create trigger trg_mfg_products_photo_gate ... alter function ... owner to scm_engine); then update scm.mfg_products p set status = 'INACTIVE' where p.status = 'ACTIVE' and p.category::text in ('BUILTIN','FURNITURE','LIGHTING','APPLIANCE','SOFT') and not exists (select 1 from scm.mfg_product_photos ph where ph.product_id = p.id) (exactly the rows this file activated, plus any created photo-less since).
-- SKU photos are optional (owner, 20 Oct 2026: "Why do I need to add photos? Without a photo is fine.").
-- Undoes the photo rule of 0061 / 0062: no group needs a photo, the backstop trigger goes, and every SKU that
-- sat INACTIVE only for want of a photo becomes ACTIVE. Photos stay uploadable and shown when present.
-- On production before this ran: 310 such SKUs (225 Built-in, 55 Furniture, 19 Lighting, 11 Soft furnishing),
-- none of them with a photo. Only photo-less rows are activated, so a SKU someone switched off on purpose
-- after adding a photo stays off.
set local search_path = scm, public, extensions;

update scm.product_category_groups set photo_required = false where photo_required;

drop trigger if exists trg_mfg_products_photo_gate on scm.mfg_products;
drop function if exists scm.mfg_products_photo_gate();

update scm.mfg_products p
   set status = 'ACTIVE'
 where p.status = 'INACTIVE'
   and p.category::text in ('BUILTIN', 'FURNITURE', 'LIGHTING', 'APPLIANCE', 'SOFT')
   and not exists (select 1 from scm.mfg_product_photos ph where ph.product_id = p.id);

notify pgrst, 'reload schema';
