-- REVERSAL (revert the code first):
--   alter table pos.tasks drop column if exists cleaning_invoice_id, drop column if exists cleaning_invoice_no;
--   alter table scm.sales_invoice_payments drop column if exists slip_key, drop column if exists slip_name, drop column if exists slip_mime;
--   delete from scm.acc_item_group_accounts where group_code = 'CLEANING';
--   delete from scm.acc_item_groups where code = 'CLEANING';
-- GRANTS: none - new columns keep the table grants; the item group rows sit in tables the engine already reads.
--
-- The cleaning team bills outside clients and records what they pay (chew, 26 Nov 2026: "add cleaning job 选外面地址
-- 填的时候就可以开单了，然后 collection 他们记录，这些都会自动连接我这边记账"). Engine: conts/cleaning-billing.ts.
--
--   scm.acc_item_groups / acc_item_group_accounts  CLEANING: a cleaning invoice's income is 570-0000 CLEANING SERVICES
--                     INCOME, as AutoCount booked these invoices (I-2609-044: Dr 300-C002 / Cr 570-0000). Its cost side
--                     670-0000 CLEANING COST; returns as every other group (510-0000 / 690-0010). Bound only on a
--                     company whose chart holds all four, and never over a binding finance set.
--   scm.sales_invoice_payments.slip_*   the client's transfer slip on a cleaning invoice's payment (SLIPS bucket).
--   pos.tasks.cleaning_invoice_id / _no the invoice an outside cleaning job is billed on: a job is billed once.

set local lock_timeout = '5s';

insert into scm.acc_item_groups (code, name) values ('CLEANING', 'Cleaning services') on conflict (code) do nothing;

insert into scm.acc_item_group_accounts (company_id, group_code, purchase_account, sales_account, sales_return_account, purchase_return_account, updated_by)
select a.company_id, 'CLEANING', '670-0000', '570-0000', '510-0000', '690-0010', 'migration 0393'
  from (select company_id from scm.accounts
         where account_code in ('670-0000', '570-0000', '510-0000', '690-0010') and is_active
         group by company_id having count(distinct account_code) = 4) a
on conflict (company_id, group_code) do nothing;

alter table scm.sales_invoice_payments
  add column if not exists slip_key text,
  add column if not exists slip_name text,
  add column if not exists slip_mime text;

alter table pos.tasks
  add column if not exists cleaning_invoice_id uuid,
  add column if not exists cleaning_invoice_no text;

create index if not exists tasks_cleaning_invoice_idx on pos.tasks (cleaning_invoice_id) where cleaning_invoice_id is not null;
