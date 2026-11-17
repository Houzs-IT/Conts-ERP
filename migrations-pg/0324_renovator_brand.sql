-- Renovation employee brand (owner, 13 Nov 2026): a Renovation employee works under The Conts or Dream Crafter, the
-- two brands Dream Crafter's projects are sold under, so the person follows that brand.
--
--   renovators.brand_id     the project brand they work under. Blank for people added before this; Employee Master asks
--                           for it on their next save.
--   public.renovation_brands the brands as the host app may see them: id, name, active, order. The host's role
--                           (pos_app) reads nothing else in schema public; the view runs with its owner's rights, as
--                           public.conts_staff (migration 0113) does the other way round.
--
-- Optional: the code reads the brand only once renovators.brand_id exists; until then saving a Renovation employee
-- answers NOT_MIGRATED.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0324, dry run first.
-- REVERSAL:
--   DROP VIEW public.renovation_brands;
--   ALTER TABLE pos.renovators DROP COLUMN brand_id;
--   select demo.sync();
set local search_path = pos;

ALTER TABLE renovators ADD COLUMN IF NOT EXISTS brand_id BIGINT REFERENCES public.project_brands(id);
CREATE INDEX IF NOT EXISTS renovators_brand_id_idx ON renovators (brand_id);

CREATE VIEW public.renovation_brands AS
  SELECT b.id, b.name, (b.active = 1) AS active, b.sort_order
    FROM public.project_brands b;

REVOKE ALL ON public.renovation_brands FROM public, anon, authenticated;
GRANT SELECT ON public.renovation_brands TO pos_app;

select demo.sync();
