-- REVERSAL: no schema change. The old values were an invoice's id and a blank customer name, which nothing read.
-- Receipts were written without the customer, and an invoice payment's receipt with the invoice's id for its number.
update scm.acc_official_receipts r
   set doc_no = si.invoice_number, customer_name = coalesce(r.customer_name, si.debtor_name)
  from scm.sales_invoices si
 where r.payment_source = 'SIPAY' and r.doc_no = si.id::text;

update scm.acc_official_receipts r
   set customer_name = so.debtor_name
  from scm.mfg_sales_orders so
 where r.payment_source = 'SOPAY' and r.customer_name is null and r.doc_no = so.doc_no;
