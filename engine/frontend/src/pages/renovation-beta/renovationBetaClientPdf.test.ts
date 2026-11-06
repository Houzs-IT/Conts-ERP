/* The Client PO PDF wears the letterhead every document prints, not a teal band of its own, and names the supplier code. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ header: [] as unknown[], tables: [] as Array<{ head: string[][]; body: unknown[][] }>, rects: 0, loaded: 0 }));
vi.mock("jspdf-autotable", () => ({ default: (_d: unknown, t: { head: string[][]; body: unknown[][] }) => { h.tables.push(t); } }));
vi.mock("../../vendor/scm/lib/pdf-common", () => ({
  drawHeader: (_d: unknown, o: unknown) => { h.header.push(o); return 40; },
  ensurePdfCjkFont: async () => undefined,
  fmtDocDate: (d: string) => d,
}));
vi.mock("../../lib/renovation/api", () => ({ loadDocLetterhead: async () => { h.loaded += 1; } }));
vi.mock("../../lib/branding", () => ({ ensureBrandingLogoLoaded: async () => undefined }));

import { jsPDF } from "jspdf";
import { downloadClientPdf } from "./renovationBetaClientPdf";
import type { ClientItem } from "./renovationBetaVoPo";

const item = { key: "a", description: "Hood", itemCode: "APP-1", supplierCode: "HD-900", area: "Kitchen", qty: 1, uom: "UNIT", measure: null, categoryLabel: "Appliance", categorySort: 1, subLabel: "General", subSort: 1 } as unknown as ClientItem;

describe("downloadClientPdf", () => {
  beforeEach(() => { h.header.length = 0; h.tables.length = 0; h.loaded = 0; vi.spyOn(jsPDF.prototype, "save").mockReturnValue(undefined as never); });
  it("draws the shared letterhead from SO Maintenance and a supplier code column", async () => {
    await downloadClientPdf({ projectName: "Unit 1", clientName: "Ali", today: "2026-11-07", items: [item] });
    expect(h.header).toHaveLength(1);
    expect(h.header[0]).toMatchObject({ docTitle: "Client PO" });
    expect(h.loaded).toBe(1);
    expect(h.tables[0]!.head[0]).toContain("Supplier code");
    expect(h.tables[0]!.body.flat()).toContain("HD-900");
  });
});
