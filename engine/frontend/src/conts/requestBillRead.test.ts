/* The New AP invoice form from a payment request, filled in further from the request's papers (chew, 16 Nov 2026).
   Pinned: the number and date as printed; descriptions line by line when the bill has as many lines (the request's
   amounts kept), else the bill's lines; the supplier matched for a payee typed in; a quotation ticked as one. */
import { describe, expect, it } from "vitest";
import { fillFromPapers } from "./requestBillRead";
import type { ApFormValues } from "../pages/scm-v2/ApInvoiceForm";
import type { BillExtraction } from "../vendor/scm/lib/payment-voucher-queries";

const base: ApFormValues = {
  supplierId: "", supplierRef: "", invoiceDate: "2026-11-16", dueDate: "", description: "Payment request PRQ-2611-001", provisional: false,
  lines: [{ rid: 1, description: "tiles", debitAccountCode: "", amountSen: 50_000, department: "supply", projectId: 7, subDepartmentId: "s-dc", unitId: "u-1", sourceRequestLineId: "L1" }],
};
const ex = (over: Partial<BillExtraction> = {}): BillExtraction => ({
  vendorName: "ACE TILES SDN BHD", vendorRegNo: null, documentKind: "invoice", invoiceNumber: "inv-0912", invoiceDate: "2026-11-10", dueDate: "2026-12-10",
  currency: "MYR", totalSen: 50_000, sstSen: null, lines: [{ description: "Porcelain tiles 60x60", amountSen: 49_000 }], ...over,
});

describe("filling the bill from the request's papers", () => {
  it("as many lines: the printed descriptions, the request's amounts; number, dates, supplier, account", () => {
    const { values, note } = fillFromPapers(base, { extraction: ex(), supplierMatch: { id: "S1", name: "ACE TILES SDN BHD" }, memory: { payeeName: "ACE", debitAccountCode: "601-0001", purpose: null, timesSeen: 2 } });
    expect(values).toMatchObject({ supplierId: "S1", supplierRef: "INV-0912", invoiceDate: "2026-11-10", dueDate: "2026-12-10", provisional: false });
    expect(values.lines).toEqual([expect.objectContaining({ description: "PORCELAIN TILES 60X60", amountSen: 50_000, projectId: 7, unitId: "u-1", sourceRequestLineId: "L1", debitAccountCode: "601-0001" })]);
    expect(note).toMatch(/Looks like supplier ACE TILES/);
  });
  it("other lines on the bill: its lines and amounts, to check; a quotation ticked; the request's supplier and due date kept", () => {
    const { values, note } = fillFromPapers({ ...base, supplierId: "S9", dueDate: "2026-11-30" }, {
      extraction: ex({ documentKind: "quotation", lines: [{ description: "tiles", amountSen: 30_000 }, { description: "labour", amountSen: 20_000 }] }), supplierMatch: { id: "S1", name: "ACE" }, memory: null,
    });
    expect(values).toMatchObject({ supplierId: "S9", dueDate: "2026-11-30", provisional: true });
    expect(values.lines.map((l) => [l.description, l.amountSen, l.projectId, l.sourceRequestLineId])).toEqual([["TILES", 30_000, 7, "L1"], ["LABOUR", 20_000, 7, null]]);
    expect(note).toMatch(/quotation/);
    expect(note).toMatch(/check each line/);
  });
  it("nothing readable on the lines: the request's lines stay", () => {
    const { values } = fillFromPapers(base, { extraction: ex({ lines: [], invoiceNumber: null }), supplierMatch: null, memory: null });
    expect(values.lines).toEqual(base.lines);
    expect(values.supplierRef).toBe("");
  });
});
