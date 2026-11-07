import { describe, expect, test } from "vitest";
import { voListLines, type VoAmendmentLine, type VoSoItem } from "./renovationVoListRead";

const line = (o: Partial<VoAmendmentLine> & { id: string; change_type: string }): VoAmendmentLine => ({
  amendment_id: "a", sales_order_item_id: null, new_item_code: null, new_qty: null, new_unit_price_sen: null,
  new_discount_sen: null, old_snapshot: null, ...o,
});
const item = (o: Partial<VoSoItem> & { id: string }): VoSoItem => ({
  item_code: null, description: null, qty: null, unit_price_sen: null, uom: null, location: null, ...o,
});
const items = (...r: VoSoItem[]) => new Map(r.map((x) => [x.id, x]));

describe("voListLines", () => {
  test("an added line has no before and carries its full amount", () => {
    const out = voListLines(
      [line({ id: "1", change_type: "ADD", sales_order_item_id: "s1", new_item_code: "RN-HACKING", new_qty: 1, new_unit_price_sen: 233000 })],
      items(item({ id: "s1", item_code: "RN-HACKING", description: "Hacking", uom: "LOT", location: "Kitchen" })),
    );
    expect(out).toEqual([{
      change: "Added", room: "Kitchen", itemCode: "RN-HACKING", description: "Hacking", before: null,
      after: { qty: 1, uom: "LOT", unitPriceSen: 233000 }, amountSen: 233000,
    }]);
  });

  test("a removed line reads its before from the snapshot and subtracts it", () => {
    const out = voListLines(
      [line({ id: "1", change_type: "REMOVE", sales_order_item_id: "s1", old_snapshot: { item_code: "RN-PAINTING", description: "Painting", qty: 1, unit_price_sen: 80000, total_sen: 80000, uom: "LOT", location: "Bedroom 2" } })],
      items(item({ id: "s1", item_code: "RN-PAINTING", qty: 1, location: "Bedroom 2" })),
    );
    expect(out[0]).toMatchObject({ change: "Removed", room: "Bedroom 2", before: { qty: 1, uom: "LOT", unitPriceSen: 80000 }, after: null, amountSen: -80000 });
  });

  test("a REMOVE and its ADD of the same room and SKU are one Changed line", () => {
    const out = voListLines(
      [
        line({ id: "1", change_type: "REMOVE", sales_order_item_id: "s1", old_snapshot: { item_code: "RN-PLASTER", qty: 120, unit_price_sen: 800, total_sen: 96000, uom: "SQFT", location: "Living" } }),
        line({ id: "2", change_type: "ADD", sales_order_item_id: "s2", new_item_code: "RN-PLASTER", new_qty: 160, new_unit_price_sen: 800 }),
      ],
      items(item({ id: "s1", item_code: "RN-PLASTER", location: "Living" }), item({ id: "s2", item_code: "RN-PLASTER", uom: "SQFT", location: "Living" })),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      change: "Changed", before: { qty: 120, uom: "SQFT", unitPriceSen: 800 }, after: { qty: 160, uom: "SQFT", unitPriceSen: 800 }, amountSen: 32000,
    });
  });

  test("a partly omitted line is Changed", () => {
    const out = voListLines(
      [line({ id: "1", change_type: "MODIFY", sales_order_item_id: "s1", new_qty: 2, new_unit_price_sen: 5000, new_discount_sen: 0, old_snapshot: { item_code: "X", qty: 3, unit_price_sen: 5000, total_sen: 15000 } })],
      items(item({ id: "s1", item_code: "X", qty: 2 })),
    );
    expect(out[0]).toMatchObject({ change: "Changed", amountSen: -5000 });
  });

  /* The owner's rule for imported VOs: show what exists, never invent it. The SO line's qty is the AFTER, so falling
     back to it would print the new quantity in the Before column. */
  test("no snapshot means no before and no amount, not the SO line's current values", () => {
    const out = voListLines(
      [line({ id: "1", change_type: "MODIFY", sales_order_item_id: "s1", new_qty: 2, new_unit_price_sen: 5000 })],
      items(item({ id: "s1", item_code: "X", qty: 2, unit_price_sen: 5000 })),
    );
    expect(out[0].before).toBeNull();
    expect(out[0].amountSen).toBeNull();
    expect(out[0].after).toMatchObject({ qty: 2, unitPriceSen: 5000 });
  });

  test("a removed line with no snapshot has no amount", () => {
    const out = voListLines([line({ id: "1", change_type: "REMOVE", sales_order_item_id: "s1" })], items(item({ id: "s1", item_code: "X", qty: 2 })));
    expect(out[0]).toMatchObject({ change: "Removed", before: null, amountSen: null });
  });
});
