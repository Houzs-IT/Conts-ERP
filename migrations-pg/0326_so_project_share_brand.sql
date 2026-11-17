-- A sales order and its project share one brand (owner, 13 Nov 2026): for every open SO linked to a project, whichever
-- side has no brand takes the other's, as linking now does. A brand already set on either side is never changed.
-- Each change is printed as a NOTICE ("0326 so <doc_no> <brand>" or "0326 project <id> <brand>") in the run log.
-- On production before this ran: 2 SOs (TC-SO-2611-031, TC-SO-2611-032), no projects.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0326, dry run first.
-- REVERSAL: from the printed lines,
--   UPDATE scm.mfg_sales_orders SET branding = NULL WHERE doc_no IN (<printed "so" doc_nos>);
--   UPDATE scm.reno_so_contracts SET brand_id = NULL WHERE so_doc_no IN (<printed "so" doc_nos with "contract brand set">);
--   UPDATE public.projects SET brand = NULL WHERE id IN (<printed "project" ids>);
do $$
declare
  r record;
begin
  for r in
    select s.doc_no, p.brand, b.id as brand_id, k.so_doc_no is not null and k.brand_id is null as contract_blank
      from scm.mfg_sales_orders s
      join public.projects p on p.id = s.project_id
      left join scm.reno_so_contracts k on k.so_doc_no = s.doc_no
      left join lateral (
        select pb.id from public.project_brands pb
         where pb.company_id = p.company_id and lower(trim(pb.name)) = lower(trim(p.brand))
         order by pb.active desc, pb.id limit 1
      ) b on true
     where s.status::text not in ('CANCELLED', 'CLOSED')
       and nullif(trim(s.branding), '') is null and nullif(trim(p.brand), '') is not null
     order by s.doc_no
  loop
    update scm.mfg_sales_orders set branding = r.brand, updated_at = now() where doc_no = r.doc_no;
    if r.contract_blank and r.brand_id is not null then
      update scm.reno_so_contracts set brand_id = r.brand_id where so_doc_no = r.doc_no;
    end if;
    raise notice '0326 so % % (contract brand %)', r.doc_no, r.brand,
      case when r.contract_blank and r.brand_id is not null then 'set' else 'kept' end;
  end loop;

  for r in
    select distinct on (p.id) p.id, s.branding
      from public.projects p
      join scm.mfg_sales_orders s on s.project_id = p.id
     where s.status::text not in ('CANCELLED', 'CLOSED')
       and nullif(trim(p.brand), '') is null and nullif(trim(s.branding), '') is not null
     order by p.id, (s.so_kind = 'RENOVATION') desc, s.created_at desc
  loop
    update public.projects set brand = r.branding,
      updated_at = to_char(timezone('UTC', now()), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') where id = r.id;
    raise notice '0326 project % %', r.id, r.branding;
  end loop;
end $$;
