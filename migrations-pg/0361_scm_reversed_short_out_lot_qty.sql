-- REVERSAL: re-run scm.fn_inventory_movement_fifo() from 0044_scm_schema.sql (the IN branch without the 0361 block);
--           alter table scm.inventory_movements drop column reverses_movement_id;
-- 0361 - a reversed short stock-out (not a DO) puts back only what it took (D15, #1126).
--
-- THE DEFECT
--   A stock-out that finds too little in the lots consumes what is there and records the rest as short; the
--   movement still carries the full qty. Reversing it (cancel / line delete: reverseMovements, production undo
--   start) writes an IN of the full qty, and this trigger opened a lot for all of it, so the lots ended above the
--   movement balance by the short. Only DO OUTs were repaired (fn_reconcile_uncosted_out filters on 'DO').
--
-- THE FIX
--   A reversing IN names the OUT it undoes (inventory_movements.reverses_movement_id, written by the engine). When
--   that OUT is not a DO, the lot opened is the qty the OUT consumed (its inventory_lot_consumptions) at the cost it
--   consumed, and no lot when it took nothing. The movement keeps its full qty, so balances and lots agree again.
--   An IN without the column set (every other IN) is unchanged.
--
-- Production 22 Nov 2026: 3 stock buckets, 0 where lots differ from the movement balance.

alter table scm.inventory_movements add column if not exists reverses_movement_id uuid;
comment on column scm.inventory_movements.reverses_movement_id is 'The OUT this IN reverses (0361): the FIFO trigger re-opens only what that OUT consumed.';

CREATE OR REPLACE FUNCTION scm.fn_inventory_movement_fifo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'scm', 'pg_temp'
AS $function$
DECLARE
  v_result    RECORD;
  v_fallback  RECORD;
  v_abs_qty   INTEGER;
  v_cost      INTEGER;
  v_short     INTEGER;
  v_avg_cost  INTEGER;
  v_unit_cost INTEGER;
  v_lot_qty   INTEGER;
  v_lot_cost  INTEGER;
BEGIN
  IF NEW.movement_type = 'IN' THEN
    v_lot_qty  := NEW.qty;
    v_lot_cost := COALESCE(NEW.unit_cost_sen, 0);
    -- 0361: the IN undoes a stock-out that is not a DO. That OUT took from the lots only what they held (its
    -- consumptions); the short part never left a lot, so only what it took goes back into one. The movement keeps
    -- its full qty, so the movement balance returns to where it was, and so do the lots. DO OUTs keep their own
    -- path (fn_reverse_do_out and the 0154 retro-cost).
    IF NEW.reverses_movement_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM inventory_movements o
          WHERE o.id = NEW.reverses_movement_id AND o.movement_type = 'OUT' AND o.source_doc_type IS DISTINCT FROM 'DO')
    THEN
      SELECT LEAST(NEW.qty, COALESCE(SUM(c.qty_consumed), 0))::int,
             CASE WHEN COALESCE(SUM(c.qty_consumed), 0) > 0 THEN (SUM(c.total_cost_sen) / SUM(c.qty_consumed))::int ELSE 0 END
        INTO v_lot_qty, v_lot_cost
        FROM inventory_lot_consumptions c
       WHERE c.movement_id = NEW.reverses_movement_id;
    END IF;
    IF v_lot_qty > 0 THEN
      INSERT INTO inventory_lots (
        warehouse_id, item_code, variant_key, product_name,
        qty_received, qty_remaining, unit_cost_sen,
        received_at, source_doc_type, source_doc_id, source_doc_no,
        movement_id, created_by, batch_no, company_id
      ) VALUES (
        NEW.warehouse_id, NEW.item_code, NEW.variant_key, NEW.product_name,
        v_lot_qty, v_lot_qty, v_lot_cost,
        NEW.created_at,
        NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
        NEW.id, NEW.performed_by, NEW.batch_no, NEW.company_id
      );
    END IF;
    UPDATE inventory_movements
       SET total_cost_sen = v_lot_qty * v_lot_cost,
           unit_cost_sen  = CASE WHEN NEW.reverses_movement_id IS NOT NULL THEN v_lot_cost ELSE unit_cost_sen END
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'OUT' THEN
    v_abs_qty := ABS(NEW.qty);
    IF NEW.batch_no IS NOT NULL THEN
      -- Exact dye-lot batch consume first (sofa set stays colour-matched).
      SELECT * INTO v_result
        FROM fn_consume_fifo_batch(
          NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_abs_qty, NEW.batch_no,
          NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
          NEW.id, NEW.performed_by
        );
      v_cost  := v_result.total_cost_sen;
      v_short := v_result.qty_short;
      -- Ledger-divergence fix (0195): the exact batch matched no (or too few) open
      -- lots. Rather than DISCARD the short (leaving the OUT uncosted + the lots
      -- un-decremented forever — the MAKOTO false-short), fall back to plain
      -- product+variant FIFO (any batch) for the residual so present stock of the
      -- same SKU is consumed + costed. Genuine shorts (no stock at all) survive
      -- the fallback and stay on the 0154 retro-cost path, unchanged.
      IF v_short > 0 THEN
        SELECT * INTO v_fallback
          FROM fn_consume_fifo(
            NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_short,
            NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
            NEW.id, NEW.performed_by
          );
        v_cost  := v_cost + v_fallback.total_cost_sen;
        v_short := v_fallback.qty_short;
      END IF;
    ELSE
      SELECT * INTO v_result
        FROM fn_consume_fifo(
          NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_abs_qty,
          NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
          NEW.id, NEW.performed_by
        );
      v_cost  := v_result.total_cost_sen;
      v_short := v_result.qty_short;
    END IF;
    UPDATE inventory_movements
       SET total_cost_sen = v_cost,
           unit_cost_sen  = CASE WHEN v_abs_qty > 0
                                 THEN v_cost / v_abs_qty
                                 ELSE 0 END
     WHERE id = NEW.id;

  ELSIF NEW.movement_type = 'ADJUSTMENT' THEN
    IF NEW.qty > 0 THEN
      SELECT CASE WHEN SUM(qty_remaining) > 0
                  THEN SUM(qty_remaining * unit_cost_sen) / SUM(qty_remaining)
                  ELSE 0 END
        INTO v_avg_cost
        FROM inventory_lots
       WHERE warehouse_id = NEW.warehouse_id
         AND item_code = NEW.item_code
         AND variant_key  = NEW.variant_key
         AND qty_remaining > 0;

      v_unit_cost := COALESCE(NULLIF(NEW.unit_cost_sen, 0), v_avg_cost, 0);

      INSERT INTO inventory_lots (
        warehouse_id, item_code, variant_key, product_name,
        qty_received, qty_remaining, unit_cost_sen,
        received_at, source_doc_type, source_doc_id, source_doc_no,
        movement_id, created_by, batch_no, company_id
      ) VALUES (
        NEW.warehouse_id, NEW.item_code, NEW.variant_key, NEW.product_name,
        NEW.qty, NEW.qty, v_unit_cost,
        NEW.created_at,
        NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
        NEW.id, NEW.performed_by, NEW.batch_no, NEW.company_id
      );
      UPDATE inventory_movements
         SET total_cost_sen = NEW.qty * v_unit_cost,
             unit_cost_sen  = v_unit_cost
       WHERE id = NEW.id;

    ELSIF NEW.qty < 0 THEN
      v_abs_qty := ABS(NEW.qty);
      IF NEW.batch_no IS NOT NULL THEN
        SELECT * INTO v_result
          FROM fn_consume_fifo_batch(
            NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_abs_qty, NEW.batch_no,
            NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
            NEW.id, NEW.performed_by
          );
        v_cost  := v_result.total_cost_sen;
        v_short := v_result.qty_short;
        -- Same batch-drift fallback as the OUT branch: a batched write-off that
        -- matches no exact-batch lot consumes present same-SKU stock plain-FIFO
        -- instead of silently stranding the units.
        IF v_short > 0 THEN
          SELECT * INTO v_fallback
            FROM fn_consume_fifo(
              NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_short,
              NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
              NEW.id, NEW.performed_by
            );
          v_cost  := v_cost + v_fallback.total_cost_sen;
          v_short := v_fallback.qty_short;
        END IF;
      ELSE
        SELECT * INTO v_result
          FROM fn_consume_fifo(
            NEW.warehouse_id, NEW.item_code, NEW.variant_key, v_abs_qty,
            NEW.source_doc_type, NEW.source_doc_id, NEW.source_doc_no,
            NEW.id, NEW.performed_by
          );
        v_cost  := v_result.total_cost_sen;
        v_short := v_result.qty_short;
      END IF;
      UPDATE inventory_movements
         SET total_cost_sen = v_cost,
             unit_cost_sen  = CASE WHEN v_abs_qty > 0
                                   THEN v_cost / v_abs_qty
                                   ELSE 0 END
       WHERE id = NEW.id;
    END IF;
    -- NEW.qty = 0 ADJUSTMENT is a no-op.
  END IF;

  RETURN NEW;
END;
$function$;
