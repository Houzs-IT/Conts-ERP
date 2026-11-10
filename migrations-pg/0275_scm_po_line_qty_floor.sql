-- REVERSAL: DROP TRIGGER IF EXISTS trg_po_item_qty_floor ON scm.purchase_order_items;
--           DROP FUNCTION IF EXISTS scm.fn_po_item_qty_floor();
--   Purely a guard: it writes no row, so dropping it changes no stored data.
--   The app's received floor (ReceivedFloorError, lib/po-revision.ts and
--   reviseBoundPo) and the PO line-edit GRN lock are still in place.
--   GRANTS: none to re-apply — a trigger and a function only.
--
-- PORTED from Houzs 3daaba932 (#4625), TODO item 7.
-- CONTS (renovation): a VO that cuts a PO line keeps at least what was received (renovation-vo.ts poLineTargets);
--   an issued PO goes through a PO amendment, whose ReceivedFloorError answers this code with the same 409.
--
-- WHAT THIS CHANGES (the PO twin of 0274). A cut to a
--   Purchase Order line's qty that leaves it below what live GRNs have already
--   received is refused with SQLSTATE P0411, the same code and the same sum as
--   the PO -> GRN cap (scm.assert_po_line_not_over_received, 0272).
--
--   The app already refuses such a cut (ReceivedFloorError), but from a read
--   of purchase_order_items.received_qty taken BEFORE the write. A GRN posted
--   between that read and the line update slips through. This trigger runs the
--   cap under the same row lock the GRN-line trigger takes, so whichever write
--   comes second sees the first one and is refused.
--
--   ONLY A CUT IS CHECKED (WHEN NEW.qty < OLD.qty). A raise, a same-qty write
--   and every other column pass untouched, so a PO line already over its qty
--   still takes ordinary edits.
--
-- Verified against: engine/backend/tests-pg/poLineQtyFloor.pg.test.ts (postgres:16).

set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION scm.fn_po_item_qty_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = scm, public
AS $$
BEGIN
  PERFORM scm.assert_po_line_not_over_received(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_item_qty_floor ON scm.purchase_order_items;
CREATE TRIGGER trg_po_item_qty_floor
  AFTER UPDATE OF qty ON scm.purchase_order_items
  FOR EACH ROW
  WHEN (NEW.qty < OLD.qty)
  EXECUTE FUNCTION scm.fn_po_item_qty_floor();

-- SECURITY DEFINER functions are not for calling: only these triggers run them (a trigger needs no EXECUTE grant),
-- so nobody may call one through the API (repo pattern, 0243 / 0250).
revoke all on function scm.fn_po_item_qty_floor() from public, anon, authenticated;
