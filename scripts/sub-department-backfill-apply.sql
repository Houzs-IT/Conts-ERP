-- Tag November's lines with their sub-department: STEP 2, the updates. Run ONLY on chew's go, after the counts in
-- sub-department-backfill.sql were shown to him; then run that file again (every count 0). The rules are explained
-- there. One transaction: all or nothing. A line's department never changes.

begin;

-- 1. A receipt line on a maintenance job (no project): Maintenance.
update scm.staff_receipt_lines l set sub_department_id = m.id
  from scm.staff_receipts r,
       (select distinct on (s.company_id) s.company_id, s.id from scm.acc_sub_departments s
          join public.conts_departments d on d.id::text = s.staff_department_id and d.kind = 'maintenance'
          where s.active and s.department = 'rental' order by s.company_id, s.sort, s.name) m
  where r.id = l.receipt_id and m.company_id = r.company_id
    and l.sub_department_id is null and l.department = 'rental' and l.maintenance_issue_id is not null and l.project_id is null
    and r.spend_date >= '2026-11-01';

-- 2. A receipt line paid from a float (no project): the float's department's, when it is the line's department.
update scm.staff_receipt_lines l set sub_department_id = (
    select s.id from scm.acc_sub_departments s
    where s.company_id = r.company_id and s.active and s.staff_department_id = f.department_id and s.department = l.department
    order by s.sort, s.name limit 1)
  from scm.staff_receipts r, scm.petty_cash_floats f
  where r.id = l.receipt_id and f.id = r.float_id
    and l.sub_department_id is null and l.maintenance_issue_id is null and l.project_id is null and r.spend_date >= '2026-11-01'
    and exists (select 1 from scm.acc_sub_departments s where s.company_id = r.company_id and s.active
                and s.staff_department_id = f.department_id and s.department = l.department);

-- 3. A Renovation line on a project: its brand. One statement per table; the same project-kind rule in each.
create temporary table reno_kind on commit drop as
  select p.id as project_id, s.id as sub_id
  from public.projects p
  left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand
  join scm.acc_sub_departments s on s.company_id = p.company_id
   and s.fixed_key = case coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') when 'INHOUSE_RENOVATION' then 'theconts' else 'dreamcrafter' end;

update scm.payment_voucher_lines l set sub_department_id = k.sub_id
  from scm.payment_vouchers v, reno_kind k
  where v.id = l.pv_id and k.project_id = l.project_id
    and l.sub_department_id is null and l.department = 'supply' and v.voucher_date >= '2026-11-01';

update scm.ap_invoice_lines l set sub_department_id = k.sub_id
  from scm.ap_invoices i, reno_kind k
  where i.id = l.invoice_id and k.project_id = l.project_id
    and l.sub_department_id is null and l.department = 'supply' and i.invoice_date >= '2026-11-01';

update scm.payment_request_lines l set sub_department_id = k.sub_id
  from scm.payment_requests q, reno_kind k
  where q.id = l.request_id and k.project_id = l.project_id
    and l.sub_department_id is null and l.department = 'supply' and q.created_at >= '2026-11-01';

update scm.staff_receipt_lines l set sub_department_id = k.sub_id
  from scm.staff_receipts r, reno_kind k
  where r.id = l.receipt_id and k.project_id = l.project_id
    and l.sub_department_id is null and l.department = 'supply' and r.spend_date >= '2026-11-01';

-- Not a staff receipt's journal: those follow their receipt's lines in rule 4.
update scm.journal_entry_lines l set sub_department_id = k.sub_id
  from scm.journal_entries j, reno_kind k
  where j.id = l.journal_entry_id and k.project_id = l.project_id and j.source_type <> 'CLM'
    and l.sub_department_id is null and l.department = 'supply' and j.entry_date >= '2026-11-01';

-- 4. A staff receipt's journal lines (CLM): the receipt line's, by account and amount. Where two receipt lines share
--    an account and an amount, only if they also share the sub-department (no guessing).
update scm.journal_entry_lines jl set sub_department_id = m.sub_id
  from scm.journal_entries j,
       (select r.company_id, r.receipt_no, l.account_code, l.amount_sen, min(l.sub_department_id::text)::uuid as sub_id
          from scm.staff_receipts r join scm.staff_receipt_lines l on l.receipt_id = r.id
          where l.sub_department_id is not null
          group by r.company_id, r.receipt_no, l.account_code, l.amount_sen
          having count(distinct l.sub_department_id) = 1) m
  where j.id = jl.journal_entry_id and j.source_type = 'CLM'
    and m.receipt_no = j.source_doc_no and m.company_id = j.company_id
    and m.account_code = jl.account_code and m.amount_sen = jl.debit_sen
    and jl.sub_department_id is null and j.entry_date >= '2026-11-01';

commit;
