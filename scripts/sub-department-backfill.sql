-- Tag November's lines with their sub-department (SOP 1.1; chew 4 Nov 2026; plan
-- docs/superpowers/plans/2026-11-04-sub-departments.md Task 9). NOT a migration: run by hand, after 0207 is applied and
-- the code is live, and only on chew's go.
--
-- A line's department never changes here: a sub-department is only set where its department is the line's, so what
-- was posted stays in its department. Nothing was booked before 1 Nov 2026. Only lines dated from 2026-11-01 whose sub_department_id is still null move:
--   1. a staff receipt line on a maintenance job          → Maintenance (the sub-department mapped to the staff
--                                                            department of kind 'maintenance')
--   2. a staff receipt line paid from a float              → the sub-department mapped to the float's department
--   3. a Renovation line that names a project              → The Conts or Dream Crafter, by the project's kind
--                                                            (its own finance_kind, else its brand's, else Dream Crafter)
--   4. the journal lines those documents posted            → the same, matched by source document and account
--   Everything else stays null, which reads as Rental (general) / Renovation (Dream Crafter) / Company.
--
-- STEP 1 — count what each rule would change (read only). Show chew the counts.
-- STEP 2 — on chew's go: run the BEGIN … COMMIT block below, then STEP 1 again (every count 0).

/* ── STEP 1: counts ─────────────────────────────────────────────────────── */
with maint as (
  select s.company_id, s.id from scm.acc_sub_departments s
  join public.conts_departments d on d.id::text = s.staff_department_id and d.kind = 'maintenance'
  where s.active
), kind as (
  select p.id, p.company_id, coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') as k
  from public.projects p left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand
)
select 'receipt lines on a job' as rule, count(*) from scm.staff_receipt_lines l
  join scm.staff_receipts r on r.id = l.receipt_id
  join maint m on m.company_id = r.company_id
  where l.sub_department_id is null and l.department = 'rental' and l.maintenance_issue_id is not null and r.spend_date >= '2026-11-01'
union all
select 'receipt lines on a float', count(*) from scm.staff_receipt_lines l
  join scm.staff_receipts r on r.id = l.receipt_id
  join scm.petty_cash_floats f on f.id = r.float_id
  join scm.acc_sub_departments s on s.company_id = r.company_id and s.active and s.staff_department_id = f.department_id and s.department = l.department
  where l.sub_department_id is null and l.maintenance_issue_id is null and r.spend_date >= '2026-11-01'
union all
select 'voucher lines on a renovation project', count(*) from scm.payment_voucher_lines l
  join scm.payment_vouchers v on v.id = l.pv_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and v.voucher_date >= '2026-11-01'
union all
select 'AP invoice lines on a renovation project', count(*) from scm.ap_invoice_lines l
  join scm.ap_invoices i on i.id = l.invoice_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and i.invoice_date >= '2026-11-01'
union all
select 'request lines on a renovation project', count(*) from scm.payment_request_lines l
  join scm.payment_requests q on q.id = l.request_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and q.created_at >= '2026-11-01'
union all
select 'journal lines on a renovation project', count(*) from scm.journal_entry_lines l
  join scm.journal_entries j on j.id = l.journal_entry_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and j.entry_date >= '2026-11-01'
union all
select 'journal lines of tagged receipts', count(*) from scm.journal_entry_lines jl
  join scm.journal_entries j on j.id = jl.journal_entry_id and j.source_type = 'CLM'
  join scm.staff_receipts r on r.receipt_no = j.source_doc_no and r.company_id = j.company_id
  join scm.staff_receipt_lines l on l.receipt_id = r.id and l.account_code = jl.account_code and l.amount_sen = jl.debit_sen
  where jl.sub_department_id is null and l.sub_department_id is not null and j.entry_date >= '2026-11-01';

/* ── STEP 2: the updates (on chew's go) ─────────────────────────────────── */
begin;

-- 1. A receipt line on a maintenance job: Maintenance.
update scm.staff_receipt_lines l set sub_department_id = m.id
  from scm.staff_receipts r,
       (select s.company_id, s.id from scm.acc_sub_departments s
          join public.conts_departments d on d.id::text = s.staff_department_id and d.kind = 'maintenance' where s.active) m
  where r.id = l.receipt_id and m.company_id = r.company_id
    and l.sub_department_id is null and l.department = 'rental' and l.maintenance_issue_id is not null and r.spend_date >= '2026-11-01';

-- 2. A receipt line paid from a float: the float's department's.
update scm.staff_receipt_lines l set sub_department_id = s.id
  from scm.staff_receipts r, scm.petty_cash_floats f, scm.acc_sub_departments s
  where r.id = l.receipt_id and f.id = r.float_id
    and s.company_id = r.company_id and s.active and s.staff_department_id = f.department_id and s.department = l.department
    and l.sub_department_id is null and l.maintenance_issue_id is null and r.spend_date >= '2026-11-01';

-- 3. A Renovation line on a project: its brand. One statement per table; the same project-kind rule in each.
update scm.payment_voucher_lines l set sub_department_id = s.id
  from scm.payment_vouchers v, public.projects p
  left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand,
  scm.acc_sub_departments s
  where v.id = l.pv_id and p.id = l.project_id
    and s.company_id = p.company_id
    and s.fixed_key = case coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') when 'INHOUSE_RENOVATION' then 'theconts' else 'dreamcrafter' end
    and l.sub_department_id is null and l.department = 'supply' and v.voucher_date >= '2026-11-01';

update scm.ap_invoice_lines l set sub_department_id = s.id
  from scm.ap_invoices i, public.projects p
  left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand,
  scm.acc_sub_departments s
  where i.id = l.invoice_id and p.id = l.project_id
    and s.company_id = p.company_id
    and s.fixed_key = case coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') when 'INHOUSE_RENOVATION' then 'theconts' else 'dreamcrafter' end
    and l.sub_department_id is null and l.department = 'supply' and i.invoice_date >= '2026-11-01';

update scm.payment_request_lines l set sub_department_id = s.id
  from scm.payment_requests q, public.projects p
  left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand,
  scm.acc_sub_departments s
  where q.id = l.request_id and p.id = l.project_id
    and s.company_id = p.company_id
    and s.fixed_key = case coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') when 'INHOUSE_RENOVATION' then 'theconts' else 'dreamcrafter' end
    and l.sub_department_id is null and l.department = 'supply' and q.created_at >= '2026-11-01';

update scm.journal_entry_lines l set sub_department_id = s.id
  from scm.journal_entries j, public.projects p
  left join public.project_brands b on b.company_id = p.company_id and b.name = p.brand,
  scm.acc_sub_departments s
  where j.id = l.journal_entry_id and p.id = l.project_id
    and s.company_id = p.company_id
    and s.fixed_key = case coalesce(p.finance_kind, b.finance_kind, 'RENOVATION') when 'INHOUSE_RENOVATION' then 'theconts' else 'dreamcrafter' end
    and l.sub_department_id is null and l.department = 'supply' and j.entry_date >= '2026-11-01';

-- 4. The journal lines a tagged receipt posted (CLM): by receipt, account and amount.
update scm.journal_entry_lines jl set sub_department_id = l.sub_department_id
  from scm.journal_entries j, scm.staff_receipts r, scm.staff_receipt_lines l
  where j.id = jl.journal_entry_id and j.source_type = 'CLM'
    and r.receipt_no = j.source_doc_no and r.company_id = j.company_id
    and l.receipt_id = r.id and l.account_code = jl.account_code and l.amount_sen = jl.debit_sen
    and jl.sub_department_id is null and l.sub_department_id is not null and j.entry_date >= '2026-11-01';

commit;
