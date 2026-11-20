-- REVERSAL: re-run the scm.fn_stock_transfer_apply definition from 0044_scm_schema.sql
--   (the same function without the availability check). Writes no row, so
--   reverting changes no stored data. GRANTS: none - one CREATE OR REPLACE.
--
-- A stock transfer may not take out more than the SOURCE warehouse holds.
--
-- THE BUG (found 20 Nov 2026 on the local system): a transfer of 99 out of a
--   bucket holding 5 posted. fn_consume_fifo takes what it finds and returns the
--   rest as qty_short; nothing refused, so 94 units "moved" that never existed:
--   the destination gained 99, the source lost only 5, and stock was invented.
--
-- THE FIX: before each line's OUT, lock the source bucket's open lots (the same
--   rows, in the same received_at order, that fn_consume_fifo locks next, so no
--   new deadlock) and sum them. Short -> RAISE P0414 and the whole transfer rolls
--   back. The locks are held to the end of the transaction, so two transfers
--   draining one bucket at the same moment serialise and the second sees what
--   the first left: both cannot pass. Repeated lines of one bucket are covered
--   too: the first line's OUT has already drawn the lots down when the second
--   is checked.
--
--   The route checks the same rule before writing anything
--   (engine/backend/src/scm/lib/stock-transfer-availability.ts) so the usual
--   refusal leaves no document behind; this is the race backstop. DETAIL is JSON
--   {item_code, variant_key, available, requested} for the route to word.
--
--   Stock is pooled across warehouses for sales availability, but a transfer
--   physically leaves ONE warehouse, so only that warehouse's lots count.
--
-- SQLSTATE P0414 (next after the 0273 billing caps P0412/P0413).

SET search_path = scm, public;

CREATE OR REPLACE FUNCTION scm.fn_stock_transfer_apply(p_from_warehouse_id uuid, p_to_warehouse_id uuid, p_source_doc_id uuid, p_source_doc_no text, p_company_id bigint, p_performed_by uuid, p_lines jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'scm', 'pg_temp'
AS $function$
DECLARE
  v_line     JSONB;
  v_qty      INTEGER;
  v_variant  TEXT;
  v_batch    TEXT;
  v_item     TEXT;
  v_have     INTEGER;
  v_out_id   UUID;
  v_out_qty  INTEGER;
  v_out_cost INTEGER;
  v_in_unit  INTEGER;
  v_moved    INTEGER := 0;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb))
  LOOP
    v_qty := FLOOR(COALESCE((v_line->>'qty')::numeric, 0))::integer;
    CONTINUE WHEN v_qty <= 0;
    v_item    := v_line->>'item_code';
    v_variant := COALESCE(v_line->>'variant_key', '');
    v_batch   := NULLIF(v_line->>'batch_no', '');

    -- 0) The source must hold the qty. Lock first, then sum (FOR UPDATE cannot
    --    sit on the aggregate itself).
    SELECT COALESCE(SUM(l.qty_remaining), 0)::integer INTO v_have
      FROM (
        SELECT qty_remaining
          FROM scm.inventory_lots
         WHERE warehouse_id = p_from_warehouse_id
           AND item_code    = v_item
           AND variant_key  = v_variant
           AND qty_remaining > 0
         ORDER BY received_at ASC, id ASC
           FOR UPDATE
      ) l;
    IF v_have < v_qty THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0414',
        MESSAGE = format('insufficient_stock: only %s of %s at the source warehouse; this transfer asks for %s',
                         v_have, v_item, v_qty),
        DETAIL  = json_build_object('item_code', v_item, 'variant_key', v_variant,
                                    'available', v_have, 'requested', v_qty)::text,
        HINT    = 'Lower the quantity or transfer from a warehouse that holds the stock.';
    END IF;

    -- 1) OUT @ source. The AFTER-INSERT FIFO trigger consumes the source lots
    --    and stamps this row's total_cost_sen.
    INSERT INTO scm.inventory_movements (
      company_id, movement_type, warehouse_id, item_code, variant_key,
      product_name, qty, source_doc_type, source_doc_id, source_doc_no,
      batch_no, performed_by, notes
    ) VALUES (
      p_company_id, 'OUT', p_from_warehouse_id, v_item, v_variant,
      v_line->>'product_name', v_qty, 'STOCK_TRANSFER', p_source_doc_id, p_source_doc_no,
      v_batch, p_performed_by, 'Transfer to warehouse ' || p_to_warehouse_id::text
    ) RETURNING id INTO v_out_id;

    -- 2) Read back the consumed cost; the IN carries the weighted average.
    SELECT qty, COALESCE(total_cost_sen, 0)
      INTO v_out_qty, v_out_cost
      FROM scm.inventory_movements
     WHERE id = v_out_id;
    v_in_unit := CASE WHEN v_out_qty > 0
                      THEN round(v_out_cost::numeric / v_out_qty)::integer
                      ELSE 0 END;

    -- 3) IN @ destination at that cost. Any failure rolls the whole call back.
    INSERT INTO scm.inventory_movements (
      company_id, movement_type, warehouse_id, item_code, variant_key,
      product_name, qty, unit_cost_sen, source_doc_type, source_doc_id, source_doc_no,
      batch_no, performed_by, notes
    ) VALUES (
      p_company_id, 'IN', p_to_warehouse_id, v_item, v_variant,
      v_line->>'product_name', v_qty, v_in_unit, 'STOCK_TRANSFER', p_source_doc_id, p_source_doc_no,
      v_batch, p_performed_by, 'Transfer from warehouse ' || p_from_warehouse_id::text
    );

    v_moved := v_moved + 1;
  END LOOP;

  RETURN v_moved;
END;
$function$;
