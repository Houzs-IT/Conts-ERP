/* DO and GR download: one document through its own generator; all carry each document's renovation details. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rendered: [] as unknown[][] }));
vi.mock("../../lib/printDocumentPdf", () => ({
  fetchPrintBundle: async (t: { key: string }) => ({ header: { id: t.key }, items: [] }),
  renderPrintBundle: async (...a: unknown[]) => { h.rendered.push(a); },
  renoInfoFor: async (k: string, id: string) => ({ k, id }),
}));

import { docBundles, downloadDocPdf } from "./renovationBetaDocPdf";

const dord = (id: string) => ({ type: "delivery_order" as const, id, no: `DO-${id}` });
const grn = (id: string) => ({ type: "goods_received" as const, id, no: `GR-${id}` });

describe("DO and GR download", () => {
  beforeEach(() => { h.rendered.length = 0; });
  it("saves one document", async () => {
    await downloadDocPdf(grn("1"));
    expect(h.rendered[0]).toEqual([{ doc: "grn", docNo: "GR-1", key: "1" }, { header: { id: "1" }, items: [] }, "save"]);
  });
  it("draws every DO with its own details", async () => {
    expect(await docBundles([dord("1"), dord("2")])).toMatchObject([{ header: { id: "1" }, renovation: { k: "do", id: "1" } }, { header: { id: "2" }, renovation: { k: "do", id: "2" } }]);
  });
  it("and every GR", async () => {
    expect(await docBundles([grn("1")])).toMatchObject([{ renovation: { k: "grn", id: "1" } }]);
  });
});
