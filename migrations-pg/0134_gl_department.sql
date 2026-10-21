-- REVERSAL: drop view scm.v_gl_entries; recreate it as in 0044 and grant all on it to pos_app, scm_engine, service_role; alter table scm.journal_entry_lines drop column if exists department; alter table scm.payment_voucher_lines drop column if exists department; alter table scm.acc_receipt_lines drop column if exists department;
-- The department on every ledger line (finance, 21 Oct 2026; docs/superpowers/specs/2026-10-20-finance-phase1-ledger-design.md 3.5, gap G10):
--  * Rental, Supply chain or Shared (the company's own costs), so the profit and loss, trial balance and general
--    ledger can be read per side of the business.
--  * Manual journals, payment vouchers and receipts choose it per line; the engine's own postings (sales and purchase
--    invoices and the rest) are Supply chain. Every existing line, and any line written without one, is Supply chain:
--    until now the engine only booked the supply chain.
--  * scm.v_gl_entries gains the column last; the rest of its definition is unchanged (create or replace keeps grants).
-- APPLY: by hand, staging first, then production (node scripts/migrate-pg.mjs --env-file=<file>, dry-run first).

set local search_path = scm, public, extensions;

alter table scm.journal_entry_lines
  add column if not exists department text not null default 'supply' check (department in ('rental', 'supply', 'shared'));
alter table scm.payment_voucher_lines
  add column if not exists department text not null default 'supply' check (department in ('rental', 'supply', 'shared'));
alter table scm.acc_receipt_lines
  add column if not exists department text not null default 'supply' check (department in ('rental', 'supply', 'shared'));

create or replace view scm.v_gl_entries as
 select l.id as line_id,
    j.je_no,
    j.entry_date,
    j.source_type,
    j.source_doc_no,
    l.line_no,
    l.account_code,
    a.account_name,
    a.account_type,
    l.debit_sen,
    l.credit_sen,
    l.party_type,
    l.party_code,
    l.party_name,
    l.notes,
    j.posted,
    j.posted_at,
    j.company_id,
    j.reversed,
    j.reversed_by_je,
    l.department
   from scm.journal_entry_lines l
     join scm.journal_entries j on j.id = l.journal_entry_id
     join scm.accounts a on a.account_code = l.account_code and a.company_id = j.company_id
  where j.posted = true
  order by j.entry_date desc, j.je_no desc, l.line_no;
