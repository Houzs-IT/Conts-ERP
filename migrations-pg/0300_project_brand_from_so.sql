-- REVERSAL: update public.projects set brand = null where id in (the ids this set); no schema change.
-- A project with no brand whose live sales order also has none shows "The Conts" on the SO list (the company's own
-- brand is the fallback there), but its project row was blank, so the Projects list's Branding column read empty and the
-- brand filter could not find it (owner, 11 Nov 2026). Give those projects the brand their order is shown under.
update public.projects p
   set brand = 'The Conts'
 where p.project_kind = 'renovation'
   and coalesce(trim(p.brand), '') = ''
   and exists (
     select 1 from scm.mfg_sales_orders s
      where s.project_id = p.id and s.status::text <> 'CANCELLED' and coalesce(trim(s.branding), '') = ''
   );
