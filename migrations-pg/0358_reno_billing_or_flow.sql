-- 0358_reno_billing_or_flow: the renovation billing -> payment -> Official Receipt flow (chew, 21 Nov 2026).
--
-- 1. scm.acc_official_receipts.sales_invoice_id / invoice_no: the instalment sales invoice a renovation order
--    payment's receipt is for. Written by the engine (acc/receipt-invoice.ts) when the payment is recorded and again
--    when finance confirms it: the oldest live instalment invoice of the order that earlier confirmed money does not
--    cover yet; null when the order has no such invoice (the receipt names the order only). Only receipts of
--    renovation orders are linked; every other receipt keeps both columns null.
--
-- 2. Renovation instalment invoices made before this carry the customer header a sales invoice prints, as the engine
--    stamps it from now on (scm/lib/renovation-billing.ts billInstalment), filled from their order where the invoice
--    holds nothing yet (a column already set is never touched):
--      salesperson_id   the order's, so the salesperson can open and print their own customer's invoice (the sales
--                       invoice reads are scoped to salesperson_id, scm/lib/salesScope.ts);
--      debtor_code, phone, email   the order's, else the customer's debtor account;
--      address1/2, city, postcode, state, customer_state, customer_country   the order's;
--      due_date         the invoice date plus the days the order's term names (display_term "30 Days" -> 30), else
--                       the invoice date (billInstalment's dueDateOf).
--
-- REVERSAL:
--   alter table scm.acc_official_receipts drop column if exists invoice_no, drop column if exists sales_invoice_id;
--   (the header filled into the invoices is left: it is their own order's and customer's, and only empty columns
--    were written.)

set local lock_timeout = '5s';

-- 1. The receipt's invoice.
alter table scm.acc_official_receipts
  add column if not exists sales_invoice_id uuid references scm.sales_invoices(id) on delete set null,
  add column if not exists invoice_no text;
create index if not exists idx_acc_official_receipts_sales_invoice on scm.acc_official_receipts (sales_invoice_id) where sales_invoice_id is not null;

-- 2. The instalment invoices' customer header, from their order where empty.
update scm.sales_invoices si
   set salesperson_id   = coalesce(si.salesperson_id, o.salesperson_id),
       debtor_code      = coalesce(nullif(si.debtor_code, ''), o.debtor_code, d.code),
       phone            = coalesce(nullif(si.phone, ''), nullif(o.phone, ''), d.phone),
       email            = coalesce(nullif(si.email, ''), nullif(o.email, ''), d.email),
       address1         = coalesce(nullif(si.address1, ''), o.address1),
       address2         = coalesce(nullif(si.address2, ''), o.address2),
       city             = coalesce(nullif(si.city, ''), o.city),
       postcode         = coalesce(nullif(si.postcode, ''), o.postcode),
       state            = coalesce(nullif(si.state, ''), o.customer_state),
       customer_state   = coalesce(nullif(si.customer_state, ''), o.customer_state),
       customer_country = coalesce(nullif(si.customer_country, ''), o.customer_country),
       due_date         = coalesce(si.due_date, si.invoice_date + coalesce(substring(o.display_term from '(\d{1,3})')::int, 0))
  from scm.mfg_sales_orders o
  left join lateral (select x.code, x.phone, x.email from scm.debtors x
                      where x.company_id = o.company_id
                        and (x.code = o.debtor_code or (o.debtor_code is null and x.customer_id::text = o.customer_id::text))
                      order by x.is_active desc, x.created_at limit 1) d on true
 where si.so_doc_no = o.doc_no
   and o.so_kind = 'RENOVATION'
   and exists (select 1 from scm.reno_instalment_bills b where b.sales_invoice_id = si.id);
