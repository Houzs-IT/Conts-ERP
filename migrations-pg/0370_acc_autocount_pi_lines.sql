-- 0370_acc_autocount_pi_lines: what AutoCount's purchase invoices said, line by line, view only (chew, 18 + 24 Nov 2026).
--
-- AutoCount's purchase invoices from the ledger start are in the books already, each as one ACJ journal
-- (acc/autocount-journals.ts), but that journal kept only the accounts: not what was bought, nor for which project, nor
-- the supplier's own invoice number. AutoCount's Purchase journal listing has all three, one row per journal line.
--
-- 1. scm.acc_autocount_pi_lines: those rows as AutoCount printed them, one per line, keyed by the AutoCount PI number
--    (Ref 1) and the line's place in it. Read only by the screens; it posts nothing and nothing posts from it. Sent
--    again, a PI's lines are replaced whole (acc/autocount-pi-lines.ts).
-- 2. scm.purchase_invoices.autocount_pi_no: the AutoCount PI an opening bill (opening_balance) is the open balance of,
--    found by the supplier and its invoice number (AutoCount's Ref 2). Null on every other invoice.
--
-- REVERSAL:
--   alter table scm.purchase_invoices drop column if exists autocount_pi_no;
--   drop table if exists scm.acc_autocount_pi_lines;

set local lock_timeout = '5s';

create table if not exists scm.acc_autocount_pi_lines (
  company_id integer not null,
  pi_no text not null,
  line_no integer not null check (line_no > 0),
  doc_date date not null,
  supplier_code text not null,
  supplier_ref text,
  account_code text not null,
  account_desc text,
  project text,
  description text,
  debit_sen bigint not null default 0 check (debit_sen >= 0),
  credit_sen bigint not null default 0 check (credit_sen >= 0),
  created_at timestamptz not null default now(),
  primary key (company_id, pi_no, line_no)
);
create index if not exists idx_acc_autocount_pi_lines_ref on scm.acc_autocount_pi_lines (company_id, supplier_code, supplier_ref);
alter table scm.acc_autocount_pi_lines owner to scm_engine;
alter table scm.acc_autocount_pi_lines enable row level security;
revoke all on scm.acc_autocount_pi_lines from anon, authenticated;
grant all on scm.acc_autocount_pi_lines to service_role;

alter table scm.purchase_invoices add column if not exists autocount_pi_no text;
