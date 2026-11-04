-- Tag November's lines with their sub-department: STEP 1, the counts (read only). SOP 1.1; chew 4 Nov 2026; plan
-- docs/superpowers/plans/2026-11-04-sub-departments.md Task 9. NOT a migration. Run after 0207 is applied and the code
-- is live, and show chew the counts. The updates are in sub-department-backfill-apply.sql, run only on chew's go, and
-- afterwards this file again: every count 0.
--
-- Nothing was booked before 1 Nov 2026. Only lines dated from 2026-11-01 whose sub_department_id is still null move,
-- and a line's department never changes: a sub-department is set only where its department is the line's, so what was
-- posted stays in its department.
--   1. a staff receipt line on a maintenance job (no project) → Maintenance (the one sub-department mapped to the staff
--                                                               department of kind 'maintenance')
--   2. a staff receipt line paid from a float (no project)    → the sub-department mapped to the float's department
--   3. a Renovation line naming a project                     → The Conts or Dream Crafter by the project's kind (its
--                                                               own finance_kind, else its brand's, else Dream Crafter):
--                                                               voucher, AP invoice, request, staff receipt and journal
--                                                               lines — the journal ones not from a staff receipt
--   4. a staff receipt's journal lines (CLM)                   → the receipt line's, matched by account and amount
--   Everything else stays null, which reads as Rental (general) / Renovation (Dream Crafter) / Company.

with maint as (
  select distinct on (s.company_id) s.company_id, s.id from scm.acc_sub_departments s
  join public.conts_departments d on d.id::text = s.staff_department_id and d.kind = 'maintenance'
  where s.active and s.department = 'rental' order by s.company_id, s.sort, s.name
)
select '1 receipt lines on a job' as rule, count(*) from scm.staff_receipt_lines l
  join scm.staff_receipts r on r.id = l.receipt_id
  join maint m on m.company_id = r.company_id
  where l.sub_department_id is null and l.department = 'rental' and l.maintenance_issue_id is not null and l.project_id is null
    and r.spend_date >= '2026-11-01'
union all
select '2 receipt lines on a float', count(*) from scm.staff_receipt_lines l
  join scm.staff_receipts r on r.id = l.receipt_id
  join scm.petty_cash_floats f on f.id = r.float_id
  where l.sub_department_id is null and l.maintenance_issue_id is null and l.project_id is null and r.spend_date >= '2026-11-01'
    and exists (select 1 from scm.acc_sub_departments s where s.company_id = r.company_id and s.active
                and s.staff_department_id = f.department_id and s.department = l.department)
union all
select '3 voucher lines on a renovation project', count(*) from scm.payment_voucher_lines l
  join scm.payment_vouchers v on v.id = l.pv_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and v.voucher_date >= '2026-11-01'
union all
select '3 AP invoice lines on a renovation project', count(*) from scm.ap_invoice_lines l
  join scm.ap_invoices i on i.id = l.invoice_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and i.invoice_date >= '2026-11-01'
union all
select '3 request lines on a renovation project', count(*) from scm.payment_request_lines l
  join scm.payment_requests q on q.id = l.request_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and q.created_at >= '2026-11-01'
union all
select '3 receipt lines on a renovation project', count(*) from scm.staff_receipt_lines l
  join scm.staff_receipts r on r.id = l.receipt_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and r.spend_date >= '2026-11-01'
union all
select '3 journal lines on a renovation project (not a receipt''s)', count(*) from scm.journal_entry_lines l
  join scm.journal_entries j on j.id = l.journal_entry_id
  where l.sub_department_id is null and l.department = 'supply' and l.project_id is not null and j.source_type <> 'CLM'
    and j.entry_date >= '2026-11-01'
union all
select '4 receipt journal lines (CLM)', count(*) from scm.journal_entry_lines jl
  join scm.journal_entries j on j.id = jl.journal_entry_id and j.source_type = 'CLM'
  where jl.sub_department_id is null and jl.debit_sen > 0 and j.entry_date >= '2026-11-01';
