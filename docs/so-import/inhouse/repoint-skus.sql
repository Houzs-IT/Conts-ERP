-- In-house SO import, 3 Nov 2026 (owner): the Skyline Embassy lines the import put on RN-PROJECT_MGMT for want of a
-- product (docs/so-import/inhouse/README.md) move to the SKUs of sku-batch3 (docs/catalog-import/batch3):
--   "DINING TABLE ..."  -> FUR-GEN-DINTABLE   (18 lines)
--   "WORKING TABLE ..." -> FUR-GEN-WORKTABLE  (10 lines)
--   "INSTALLATION"      -> RN-INSTALLATION    (18 lines)
-- Lines are told apart by the quoted wording the import kept in the SO item's remark; "PROJECT SUPERVISE" stays on
-- RN-PROJECT_MGMT. Only the code changes, and the SO item's description, which shows the product name; price, qty,
-- room and the contract line's quoted wording stay. The SO item and its contract line (reno_doc_lines.so_item_id) move
-- together. One audit row per SO. Only TC-SO-2610-007..024 (The Conts, renovation) are touched; the quotations they
-- came from are frozen revisions and keep their codes.
-- Run after batch3-inhouse-skus.sql. Refuses to run unless exactly 46 lines are found and totals are unchanged.
begin;

create temp table rp on commit drop as
select i.id as item_id, i.doc_no, i.line_no, i.item_code as old_code,
       case when i.remark like 'DINING TABLE%' then 'FUR-GEN-DINTABLE'
            when i.remark like 'WORKING TABLE%' then 'FUR-GEN-WORKTABLE'
            when i.remark = 'INSTALLATION' then 'RN-INSTALLATION' end as new_code,
       i.remark
  from scm.mfg_sales_order_items i
  join scm.mfg_sales_orders o on o.doc_no = i.doc_no
 where o.branding = 'The Conts' and o.so_kind = 'RENOVATION' and o.doc_no between 'TC-SO-2610-007' and 'TC-SO-2610-024'
   and i.item_code = 'RN-PROJECT_MGMT'
   and (i.remark like 'DINING TABLE%' or i.remark like 'WORKING TABLE%' or i.remark = 'INSTALLATION');

create temp table rp_before on commit drop as
select o.doc_no, o.local_total_sen, (select coalesce(sum(total_sen), 0) from scm.mfg_sales_order_items i where i.doc_no = o.doc_no) as items_sen
  from scm.mfg_sales_orders o where o.doc_no between 'TC-SO-2610-007' and 'TC-SO-2610-024' and o.branding = 'The Conts';

do $$ begin
  if (select count(*) from rp) <> 46 then raise exception 'expected 46 lines, found %', (select count(*) from rp); end if;
  if (select count(*) from scm.reno_doc_lines l join rp on rp.item_id = l.so_item_id) <> 46 then raise exception 'expected one contract line per SO item'; end if;
  if (select count(*) from scm.mfg_products p join public.companies c on c.id = p.company_id and c.code = 'HOUZS'
       where p.code in ('FUR-GEN-DINTABLE', 'FUR-GEN-WORKTABLE', 'RN-INSTALLATION') and p.status = 'ACTIVE') <> 3 then raise exception 'run batch3-inhouse-skus.sql first'; end if;
end $$;

update scm.mfg_sales_order_items i
   set item_code = rp.new_code, description = p.name
  from rp join scm.mfg_products p on p.code = rp.new_code and p.company_id = (select id from public.companies where code = 'HOUZS')
 where i.id = rp.item_id;

update scm.reno_doc_lines l set item_code = rp.new_code, updated_at = now() from rp where l.so_item_id = rp.item_id;

insert into scm.mfg_so_audit_log (id, so_doc_no, action, actor_id, actor_name_snapshot, field_changes, status_snapshot, source, note, company_id)
select gen_random_uuid(), rp.doc_no, 'UPDATE_LINE', null, 'SKU fix (in-house import)',
       jsonb_agg(jsonb_build_object('line_no', rp.line_no, 'field', 'item_code', 'from', rp.old_code, 'to', rp.new_code, 'line', rp.remark) order by rp.line_no),
       o.status::text, 'renovation',
       'Catalog SKUs for lines imported without one (owner, 3 Nov 2026): ' || string_agg(rp.remark || ' -> ' || rp.new_code, '; ' order by rp.line_no)
         || '. Price, qty and room unchanged.',
       o.company_id
  from rp join scm.mfg_sales_orders o on o.doc_no = rp.doc_no
 group by rp.doc_no, o.status, o.company_id;

do $$ begin
  if exists (select 1 from rp_before b join scm.mfg_sales_orders o on o.doc_no = b.doc_no
              where o.local_total_sen <> b.local_total_sen
                 or (select coalesce(sum(total_sen), 0) from scm.mfg_sales_order_items i where i.doc_no = b.doc_no) <> b.items_sen)
  then raise exception 'an SO total changed'; end if;
  if (select sum(local_total_sen) from scm.mfg_sales_orders where doc_no between 'TC-SO-2610-007' and 'TC-SO-2610-024' and branding = 'The Conts') <> 57977000
  then raise exception 'the 18 SOs no longer total RM 579,770.00'; end if;
  if exists (select 1 from scm.reno_doc_lines l join rp on rp.item_id = l.so_item_id where l.item_code <> rp.new_code)
  then raise exception 'a contract line did not move'; end if;
end $$;

commit;
