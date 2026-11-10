/* Export PDF prints the document the order's own page prints: same generator, rooms and contract block, saved. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as unknown[][], order: [] as string[] }));
vi.mock("../../lib/printDocumentPdf", () => ({
  fetchPrintBundle: async (t: { docNo: string }) => { h.order.push(t.docNo); return { header: { doc_no: t.docNo }, items: [{ id: "i1" }], payments: [], pwpCodes: [] }; },
}));
vi.mock("../projects/renovation/customerPropertyApi", () => ({
  soInfoApi: { so: async () => ({ project: { startDate: "2026-11-01", endDate: null }, roomSections: ["Kitchen"], itemRooms: { i1: "Kitchen" } }) },
}));
vi.mock("../../lib/renovation/api", () => ({
  renoGet: async (path: string) => (path === "/brands"
    ? { brands: [{ brandId: 2, name: "Dream", logoR2Key: "k", companyLines: ["Co"], contactLine: "tel", bankLine: "bank", termsLines: [] }] }
    : { header: { brandId: 2 }, instalments: [{ label: "Deposit", pctBp: 5000, description: "" }] }),
}));
vi.mock("../../vendor/scm/lib/sales-order-pdf", () => ({ generateSalesOrderPdf: async (...a: unknown[]) => { h.calls.push(a); } }));

import { downloadSoPdfs } from "./soPdfDownload";

describe("downloadSoPdfs", () => {
  beforeEach(() => { h.calls.length = 0; h.order.length = 0; });
  it("saves the order with its rooms and contract block", async () => {
    await downloadSoPdfs([{ docNo: "TC-SO-1", renovation: true }]);
    const [header, , , action, , opts] = h.calls[0]!;
    expect(header).toEqual({ doc_no: "TC-SO-1" });
    expect(action).toBe("save");
    expect(opts).toMatchObject({ rooms: { order: ["Kitchen"], byItem: { i1: "Kitchen" } }, contract: { brandName: "Dream", instalments: [{ label: "Deposit", percent: "50%" }] } });
  });
  it("gives each order its own file, one at a time", async () => {
    await downloadSoPdfs([{ docNo: "A" }, { docNo: "B" }]);
    expect(h.order).toEqual(["A", "B"]);
    expect(h.calls[0]![5]).toMatchObject({ contract: undefined });
  });
});
