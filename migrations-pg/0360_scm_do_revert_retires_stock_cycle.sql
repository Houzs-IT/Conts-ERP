-- 0360 - a delivery order reverted to Draft can be shipped again and its stock comes out again (D6, #1126).
--
-- THE DEFECT
--   Reverting a shipped DO to Draft (POST /delivery-orders-mfg/:id/revert) returns its stock: fn_reverse_do_out
--   writes balancing rows tagged source_doc_type = 'ADJUSTMENT' + the DO's id. Its first OUT rows stay tagged
--   'DO'. Shipping it again then deducts nothing: deductInventoryForDo sees an OUT for the DO and stops, and
--   uq_inv_mov_do_source_v2 would refuse a second OUT row for the same bucket anyway. A second revert would also
--   do nothing (fn_reverse_do_out stops when any ADJUSTMENT row for the DO exists). Stock read too high.
--
-- THE FIX
--   After a revert has returned the stock, that whole ship-and-return cycle is retired: the DO's own 'DO' rows
--   and its 'ADJUSTMENT' reversal rows are re-tagged 'DO_REVERTED' (same source_doc_id / source_doc_no, so the
--   history still names the DO). The cycle nets to zero, and stock is summed over every row regardless of tag
--   (inventory_balances), so balances do not move. The DO then reads as never shipped: the next ship deducts
--   afresh, a later revert reverses only that ship, and the cost restamp sees only the live shipment.
--
--   Refused (exception) when the DO still has stock out that no reversal returned, so a failed reversal can
--   never be hidden by re-tagging. Returns the number of rows re-tagged.
--
--   The header delete lock also counts retired rows: goods moved against the DO even if they came back.

CREATE OR REPLACE FUNCTION scm.fn_retire_do_stock_cycle(p_do_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'scm', 'pg_temp'
AS $function$
DECLARE
  v_net      BIGINT;
  v_reversed INTEGER;
  v_n        INTEGER;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN qty WHEN movement_type = 'IN' THEN -qty ELSE 0 END), 0)
    INTO v_net
    FROM scm.inventory_movements
   WHERE source_doc_type = 'DO' AND source_doc_id = p_do_id;
  SELECT COUNT(*) INTO v_reversed
    FROM scm.inventory_movements
   WHERE source_doc_type = 'ADJUSTMENT' AND source_doc_id = p_do_id;
  IF v_net > 0 AND v_reversed = 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('do_stock_cycle: delivery order %s still has stock out that was not returned', p_do_id);
  END IF;
  UPDATE scm.inventory_movements
     SET source_doc_type = 'DO_REVERTED'
   WHERE source_doc_id = p_do_id
     AND source_doc_type IN ('DO', 'ADJUSTMENT');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

CREATE OR REPLACE FUNCTION scm.fn_do_header_delete_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scm', 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM scm.inventory_movements m
     WHERE m.source_doc_type::text IN ('DO', 'DO_REVERTED')
       AND (m.source_doc_no = OLD.do_number OR m.source_doc_id::text = OLD.id::text)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('do_header_integrity: %s has inventory movements and cannot be deleted', OLD.do_number),
      HINT = 'Goods moved against this delivery order. Set status = CANCELLED instead of deleting the row.';
  END IF;
  RETURN OLD;
END;
$function$;
