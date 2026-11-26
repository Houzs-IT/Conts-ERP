-- REVERSAL: none needed - demo.sync() only rebuilds the demo views from the pos tables as they are.
-- GRANTS: none - demo.sync() keeps the demo views' grants.
--
-- Demo mode reads pos tables through the demo_pos views; 0393 added tasks.cleaning_invoice_id / cleaning_invoice_no
-- (an outside cleaning job's client invoice), so the views are rebuilt to carry them.

select demo.sync();
