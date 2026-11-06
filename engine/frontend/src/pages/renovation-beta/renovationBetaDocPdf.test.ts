/* DO and GR download: one document through its own generator, all on one PDF with each document's renovation details. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rendered: [] as unknown[][], doAll: [] as unknown[][], grAll: [] as unknown[][] }));
vi.mock("../../lib/printDocumentPdf", () => ({
  fetchPrintBundle: async (t: { key: string }) => ({ header: { id: t.key }, items: [] }),
  renderPrintBundle: async (...a: unknown[]) => { h.rendered.push(a); },
  renoInfoFor: async (_k: string, id: string) => ({ id }),
}));
vi.mock("../../vendor/scm/lib/delivery-order-pdf", () => ({ generateCombinedDeliveryOrderPdf: async (...a: unknown[]) => { h.doAll.push(a); } }));
vi.mock("../../vendor/scm/lib/grn-pdf", () => ({ generateCombinedGrnPdf: async (...a: unknown[]) => { h.grAll.push(a); } }));

import { downloadAllDocPdfs, downloadDocPdf } from "./renovationBetaDocPdf";

const dord = (id: string) => ({ type: "delivery_order" as const, id, no: `DO-${id}` });
const grn = (id: string) => ({ type: "goods_received" as const, id, no: `GR-${id}` });

describe("DO and GR download", () => {
  beforeEach(() => { h.rendered.length = 0; h.doAll.length = 0; h.grAll.length = 0; });
  it("saves one document", async () => {
    await downloadDocPdf(grn("1"));
    expect(h.rendered[0]).toEqual([{ doc: "grn", docNo: "GR-1", key: "1" }, { header: { id: "1" }, items: [] }, "save"]);
  });
  it("puts every DO on one PDF, each with its own details", async () => {
    await downloadAllDocPdfs([dord("1"), dord("2")], "Unit-DO");
    expect(h.doAll[0]![0]).toMatchObject([{ header: { id: "1" }, renovation: { id: "1" } }, { header: { id: "2" }, renovation: { id: "2" } }]);
    expect(h.doAll[0]![1]).toEqual({ fileName: "Unit-DO.pdf", action: "save" });
  });
  it("does the same for GRs, and one document is just that document", async () => {
    await downloadAllDocPdfs([grn("1"), grn("2")], "Unit-GR");
    expect(h.grAll).toHaveLength(1);
    await downloadAllDocPdfs([dord("3")], "Unit-DO");
    expect(h.rendered).toHaveLength(1);
    expect(h.doAll).toHaveLength(0);
  });
  it("nothing listed downloads nothing", async () => {
    await downloadAllDocPdfs([], "x");
    expect(h.rendered).toHaveLength(0);
  });
});
