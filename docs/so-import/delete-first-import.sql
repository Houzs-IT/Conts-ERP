-- Notion SO re-import (owner, 29-30 Oct 2026, "可以"): removes the first import so it can run again with the fixed
-- parser. Checked first on production: no payment, delivery order, invoice, instalment bill, PO line, receipt, price
-- override or trade task points at any of these orders or their lines (all 0, 30 Oct 2026).
-- What goes: the 79 imported orders (lines, sections, instalments, contracts, VOs, amendments and their status and
-- audit rows go with them through the foreign keys), their 79 quotations, the VO revision snapshots, the import's
-- note rows, the never-sent portal outbox rows of these orders, and the number counters of the months they used
-- (they reseed from the highest number still in use, so the re-import numbers from 001 again).
-- One transaction; it stops if the counts are not the expected ones.
do $$
declare
  sos text[]; quotes uuid[]; n int;
begin
  select array_agg(doc_no) into sos from scm.mfg_sales_orders where note like 'Imported from Notion SO PDF%';
  if coalesce(array_length(sos, 1), 0) <> 79 then raise exception 'expected 79 imported orders, found %', coalesce(array_length(sos, 1), 0); end if;
  select array_agg(quotation_id) into quotes from scm.reno_so_contracts where so_doc_no = any(sos);
  if exists (select 1 from scm.mfg_sales_order_payments where so_doc_no = any(sos))
     or exists (select 1 from scm.delivery_orders where so_doc_no = any(sos))
     or exists (select 1 from scm.sales_invoices where so_doc_no = any(sos))
     or exists (select 1 from scm.reno_instalment_bills where so_doc_no = any(sos))
     or exists (select 1 from scm.purchase_order_items where so_item_id in (select id from scm.mfg_sales_order_items where doc_no = any(sos)))
  then raise exception 'something now points at these orders; stopped'; end if;

  delete from scm.so_revisions where so_doc_no = any(sos);
  -- VOs first: their omit lines point at contract lines, and a cascade would null that pointer against a check
  delete from scm.reno_variation_orders where so_doc_no = any(sos);
  get diagnostics n = row_count; if n <> 27 then raise exception 'deleted % VOs', n; end if;
  delete from scm.mfg_sales_orders where doc_no = any(sos);
  get diagnostics n = row_count; if n <> 79 then raise exception 'deleted % orders', n; end if;
  delete from scm.reno_quotations where id = any(quotes);
  get diagnostics n = row_count; if n <> 79 then raise exception 'deleted % quotations', n; end if;
  delete from scm.venture_portal_outbox where doc_no = any(sos) and status = 'pending';
  delete from scm.app_config where key like 'note:so-notion-import:%';
  delete from scm.doc_number_counters where series ~ '^(TC-SO|QT)-\d{4}$';
end $$;
