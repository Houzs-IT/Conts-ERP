-- REVERSAL: drop trigger trg_mfg_products_photo_gate on scm.mfg_products; drop function scm.mfg_products_photo_gate(); drop table scm.mfg_product_photos (delete its R2 objects under mfg-product-photos/ first if the photos should not linger).
-- Photos per SKU (spec 2026-10-09 section 3): one primary plus a gallery, stored in R2 by the same pipeline as
-- model photos (scm.product_model_photos), keys minted as mfg-product-photos/<productId>/<uuid>.<ext>.
--
-- SKUs in a group with photo_required (Built-in, Furniture, Lighting, Appliances, Soft furnishing) cannot be
-- ACTIVE without a photo. The rule keys on the STORED category, so legacy Houzs categories (SOFA, ...) are exempt
-- (owner default Q12). The routes enforce it with a readable message; the trigger below is the backstop for every
-- other writer (Houzs code paths that create SKUs ACTIVE): a new SKU in such a group starts INACTIVE, and a
-- switch to ACTIVE with no photo is refused.
set local search_path = scm, public, extensions;

create table scm.mfg_product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references scm.mfg_products(id) on delete cascade,
  r2_key text not null,
  thumb_key text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  mime_type text,
  size_bytes integer,
  created_at timestamptz not null default now(),
  created_by uuid,
  company_id bigint not null default 1 references public.companies(id)
);

create unique index uq_mfg_product_photos_one_primary on scm.mfg_product_photos (product_id) where is_primary;
create index idx_mfg_product_photos_product_sort on scm.mfg_product_photos (product_id, sort_order, created_at);
create index idx_mfg_product_photos_company on scm.mfg_product_photos (company_id);
create unique index uq_mfg_product_photos_key on scm.mfg_product_photos (r2_key);

create or replace function scm.mfg_products_photo_gate()
returns trigger language plpgsql
set search_path = scm, pg_temp
as $$
declare needs_photo boolean;
begin
  select g.photo_required into needs_photo
    from scm.product_category_groups g where g.code = new.category::text;
  if not coalesce(needs_photo, false) or new.status <> 'ACTIVE' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- A brand-new SKU cannot have a photo yet: it starts INACTIVE until one is added.
    new.status := 'INACTIVE';
    return new;
  end if;
  if not exists (select 1 from scm.mfg_product_photos p where p.product_id = new.id) then
    raise exception using errcode = '23514', message = 'photo_required',
      detail = format('SKU %s is in a group that needs a photo before it can be ACTIVE', new.code);
  end if;
  return new;
end $$;

create trigger trg_mfg_products_photo_gate
  before insert or update of status, category on scm.mfg_products
  for each row execute function scm.mfg_products_photo_gate();

alter table scm.mfg_product_photos owner to scm_engine;
alter function scm.mfg_products_photo_gate() owner to scm_engine;
alter table scm.mfg_product_photos enable row level security;
revoke all on scm.mfg_product_photos from anon, authenticated;
grant all on scm.mfg_product_photos to pos_app, service_role;

notify pgrst, 'reload schema';
