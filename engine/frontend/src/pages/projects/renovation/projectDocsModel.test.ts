import { describe, expect, test } from "vitest";
import { countLabel, grsForPo, posForRow, rowSummary, soChildren, type ProjectPo } from "./projectDocsModel";

const po = (p: Partial<ProjectPo>): ProjectPo => ({
  id: "x", poNumber: "PO-1", status: "SUBMITTED", poDate: "2026-10-10", expectedAt: "2026-10-20", totalSen: 100, supplierName: "S",
  categoryGroup: "WORKS", subCategory: null, orderedQty: 2, receivedQty: 0, receipt: "none", ...p,
});

describe("procurement rows", () => {
  const pos = [
    po({ id: "a", subCategory: "ELECTRICAL" }),
    po({ id: "b", subCategory: "PLUMBING" }),
    po({ id: "c", subCategory: null }),
    po({ id: "d", categoryGroup: "BUILTIN", subCategory: "WARDROBE" }),
  ];
  test("a sub-category row takes its own POs; the category row takes the rest of the category", () => {
    expect(posForRow(pos, "WORKS", "ELECTRICAL", ["ELECTRICAL"]).map((p) => p.id)).toEqual(["a"]);
    expect(posForRow(pos, "WORKS", null, ["ELECTRICAL"]).map((p) => p.id)).toEqual(["b", "c"]);
    expect(posForRow(pos, "BUILTIN", null, ["WARDROBE"])).toEqual([]);
  });

  test("count, actual dates, late when the planned delivery passed and not all received", () => {
    const s = rowSummary([po({ poDate: "2026-10-12", expectedAt: "2026-10-25", receipt: "full" }), po({ poDate: "2026-10-09", expectedAt: "2026-10-22" })], "2026-10-13", "2026-10-14");
    expect(s).toEqual({ count: 2, received: 1, actualPoDate: "2026-10-09", actualDelivery: "2026-10-25", late: true });
    expect(countLabel(s)).toBe("2 PO · 1 received");
    expect(rowSummary([po({ receipt: "full" })], "2026-10-13", "2026-10-14").late).toBe(false);
    expect(rowSummary([], "2026-10-13", "2026-10-14").late).toBe(true);
    expect(rowSummary([], null, "2026-10-14").late).toBe(false);
    expect(rowSummary([po({ status: "CANCELLED" })], null, "2026-10-14").count).toBe(0);
    expect(countLabel({ count: 0, received: 0 })).toBe("");
  });

  test("goods receipts against a PO; a sales order's DOs and invoices (also an invoice made from its DO)", () => {
    expect(grsForPo([{ id: "g", grnNumber: "GRN-1", receivedAt: null, status: "POSTED", totalSen: 0, poIds: ["a", "b"], atSite: false }], "b").length).toBe(1);
    const row = { date: null, status: "x", amountSen: null };
    const c = soChildren({
      ready: true, projectId: 1,
      deliveryOrders: [{ ...row, id: "d1", no: "DO-1", soDocNo: "SO-1", deliveredAt: null, podR2Key: null, signed: false }, { ...row, id: "d2", no: "DO-2", soDocNo: "SO-2", deliveredAt: null, podR2Key: null, signed: false }],
      salesInvoices: [{ ...row, id: "s1", no: "SI-1", soDocNo: null, deliveryOrderId: "d1" }, { ...row, id: "s2", no: "SI-2", soDocNo: "SO-1", deliveryOrderId: null }, { ...row, id: "s3", no: "SI-3", soDocNo: "SO-2", deliveryOrderId: null }],
    }, "SO-1");
    expect([c.dos.map((x) => x.no), c.sis.map((x) => x.no)]).toEqual([["DO-1"], ["SI-1", "SI-2"]]);
  });
});
