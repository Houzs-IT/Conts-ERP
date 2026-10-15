import { describe, expect, test } from "vitest";
import { buildStatusLines } from "./procurementStatus";

describe("where a project's goods stand", () => {
  const so = [
    { id: "s1", qty: 2, category_group: "WORKS", sub_category: "ELECTRICAL" },
    { id: "s2", qty: 1, category_group: "FURNITURE", sub_category: "SOFA" },
    { id: "s3", qty: 1, category_group: null, sub_category: null },
    { id: "s4", qty: 0, category_group: "WORKS", sub_category: "ELECTRICAL" },
  ];
  const po = [
    { id: "p1", so_item_id: "s1", qty: 2, category_group: "WORKS", sub_category: "ELECTRICAL" },
    { id: "p2", so_item_id: "s2", qty: 1, category_group: "FURNITURE", sub_category: "SOFA" },
    { id: "p3", so_item_id: "s3", qty: 1, category_group: "SERVICE", sub_category: "CLEANING" },
    { id: "p4", so_item_id: null, qty: 3, category_group: "LIGHTING", sub_category: null },
  ];
  const gr = [
    { po_item_id: "p1", qty: 1, grn_id: "g1", grn_number: "GRN-1", date: "2026-10-15", at_site: false, photos: 0 },
    { po_item_id: "p1", qty: 1, grn_id: "g2", grn_number: "GRN-2", date: "2026-10-16", at_site: true, photos: 3 },
    { po_item_id: "p2", qty: 1, grn_id: "g3", grn_number: "GRN-3", date: "2026-10-15", at_site: false, photos: 0 },
  ];
  const dos = [
    { so_item_id: "s2", qty: 1, do_id: "d1", do_number: "DO-1", status: "DELIVERED", date: "2026-10-17", delivered: true, signed: true, has_pod: false },
    { so_item_id: "s1", qty: 1, do_id: "d2", do_number: "DO-2", status: "LOADED", date: "2026-10-17", delivered: false, signed: false, has_pod: false },
  ];
  const lines = buildStatusLines(so, po, gr, dos);

  test("one line per item: SO lines with a quantity, then project PO lines no SO line stands behind", () => {
    expect(lines.map((l) => [l.categoryGroup, l.subCategory, l.qty])).toEqual([
      ["WORKS", "ELECTRICAL", 2], ["FURNITURE", "SOFA", 1], ["SERVICE", "CLEANING", 1], ["LIGHTING", null, 3],
    ]);
  });

  test("ordered from its PO lines, received from their goods receipts, delivered by DO or by site receipt", () => {
    expect(lines[0]).toMatchObject({ orderedQty: 2, receivedQty: 2, deliveredQty: 1 });
    expect(lines[0].grs.map((g) => g.no)).toEqual(["GRN-1", "GRN-2"]);
    expect(lines[0].dos.map((d) => [d.no, d.delivered])).toEqual([["DO-2", false]]);
    expect(lines[1]).toMatchObject({ orderedQty: 1, receivedQty: 1, deliveredQty: 1 });
    expect(lines[3]).toMatchObject({ orderedQty: 3, receivedQty: 0, deliveredQty: 0 });
  });

  test("a stock line (never on a PO) reads ordered 0, received 0, and delivered by its DO", () => {
    const [stock] = buildStatusLines(
      [{ id: "s9", qty: 2, category_group: "WORKS", sub_category: "ELECTRICAL" }], [], [],
      [{ so_item_id: "s9", qty: 2, do_id: "d9", do_number: "DO-9", status: "DELIVERED", date: "2026-10-17", delivered: true, signed: false, has_pod: true }],
    );
    expect(stock).toMatchObject({ qty: 2, orderedQty: 0, receivedQty: 0, deliveredQty: 2 });
    expect(stock.dos.map((d) => d.no)).toEqual(["DO-9"]);
  });
});
