-- SO brand backfill (owner, 13 Nov 2026): open renovation SOs with no branding take the brand picked on their project,
-- as new ones now do at conversion. Only blank brandings are filled; Cancelled and Closed SOs are left alone.
-- Each SO changed is printed as a NOTICE ("0325 filled <doc_no> <brand>") in the run log.
--
-- APPLY: production through the GitHub workflow "Apply migrations to production" with only=0325, dry run first.
-- REVERSAL: for each doc_no the run printed,
--   UPDATE scm.mfg_sales_orders SET branding = NULL WHERE doc_no IN (<printed doc_nos>);
--   UPDATE scm.reno_so_contracts SET brand_id = NULL WHERE so_doc_no IN (<printed doc_nos whose contract had none>);
do $$
declare
  r record;
begin
  for r in
    select s.doc_no, b.id as brand_id, b.name as brand_name, c.brand_id as contract_brand_id
      from scm.mfg_sales_orders s
      join public.projects p on p.id = s.project_id
      join lateral (
        select pb.id, pb.name from public.project_brands pb
         where pb.company_id = p.company_id and lower(trim(pb.name)) = lower(trim(p.brand))
         order by pb.active desc, pb.id limit 1
      ) b on true
      left join scm.reno_so_contracts c on c.so_doc_no = s.doc_no
     where s.so_kind = 'RENOVATION'
       and s.status::text not in ('CANCELLED', 'CLOSED')
       and nullif(trim(s.branding), '') is null
       and nullif(trim(p.brand), '') is not null
     order by s.doc_no
  loop
    update scm.mfg_sales_orders set branding = r.brand_name, updated_at = now() where doc_no = r.doc_no;
    if r.contract_brand_id is null then
      update scm.reno_so_contracts set brand_id = r.brand_id where so_doc_no = r.doc_no;
    end if;
    raise notice '0325 filled % % (contract brand %)', r.doc_no, r.brand_name,
      case when r.contract_brand_id is null then 'set' else 'kept' end;
  end loop;
end $$;
