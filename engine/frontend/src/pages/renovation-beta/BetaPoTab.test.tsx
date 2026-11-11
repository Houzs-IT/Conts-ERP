/* The PO tab reads as plain text until Edit; a band sets the date of every line in it; the PO cell is one line; a
   sofa's or bedframe's variants are picked in Edit mode with the SO line's pickers. */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { setDayFirst } from "../../vendor/shared/format";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ coverage: [] as unknown[], puts: [] as Array<[string, unknown]>, patches: [] as Array<[string, unknown]>, furniture: false, pdf: [] as unknown[] }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  const get = async (path: string): Promise<unknown> => {
    if (path.endsWith("/lines")) return h.furniture ? FURNITURE : LINES;
    if (path.endsWith("/vo")) return { vos: [] };
    if (path.endsWith("/site")) return SITE;
    if (path.endsWith("/photos")) return { photos: [], areas: [], docs: { dos: [], grs: [], pos: [] }, tasks: [] };
    throw new Error(`no mock for ${path}`);
  };
  const put = async (path: string, body: unknown): Promise<unknown> => {
    h.puts.push([path, body]);
    if (path.endsWith("/line-plans")) return { ok: true, saved: (body as { itemIds: string[] }).itemIds, refused: [] };
    return { ok: true, plan: {} };
  };
  return { ...actual, api: { ...actual.api, get, put } };
});
vi.mock("../../vendor/scm/lib/authed-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../vendor/scm/lib/authed-fetch")>();
  return {
    ...actual,
    authedFetch: async (path: string, init?: { body?: string }) => {
      if (path.endsWith("/coverage")) return { coverage: h.coverage };
      h.patches.push([path, init?.body ? JSON.parse(init.body) : null]);
      // A line a live PO buys: the spec route saves it and flags the PO line.
      if (path.endsWith("/lines/bed/spec")) return { ok: true, changed: true, flags: 1 };
      return {};
    },
  };
});
vi.mock("../scm-v2/soPdfDownload", () => ({ downloadSoPdfs: async (orders: unknown) => { h.pdf.push(orders); } }));
vi.mock("../scm-v2/ProductionOrderChips", () => ({ ProductionOrderChips: () => null }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));
/* The SO line's pickers have their own test (renovationVariantPicker.test.tsx); here a pick is one button. */
vi.mock("../../vendor/scm/components/renovationVariantPicker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../vendor/scm/components/renovationVariantPicker")>();
  return {
    ...actual,
    RenovationVariantPicker: ({ category, onPatch }: { category: string; onPatch: (p: Record<string, unknown>) => void }) => (
      <button type="button" onClick={() => onPatch(category === "SOFA"
        ? { fabricCode: "PC1461-03", colourId: "PC1461-03", colourLabel: "PC1461-03" }
        : { divanHeight: '6"', totalHeight: '11"' })}>Pick for {category}</button>
    ),
  };
});

import { BetaPoTab } from "./BetaPoTab";
import type { BetaTabProps } from "./betaShared";

const base = {
  soDocNo: "TC-SO-1", soStatus: "CONFIRMED", voLocked: true, lineNo: 1, variantText: "White", variants: { colorCode: "White" }, itemGroup: "materials", uom: "UNIT",
  qty: 2, unitPriceSen: 1000, discountSen: 0, amountSen: 2000, area: "Kitchen", remark: null, supplierName: "Sup", goesTo: "po", categoryLabel: "Lighting", categorySort: 1,
  subLabel: "Downlights", subSort: 1, photoKeys: [], skuPhotos: [], gr: "no", do: "no",
};
const LINES = {
  finance: true, plansReady: true, pendingPoChanges: [],
  sos: [{ docNo: "TC-SO-1", status: "CONFIRMED", voLocked: true, renovation: true }],
  lines: [
    { ...base, id: "a", itemCode: "LT-1", description: "Downlight A", plan: { orderOn: "2026-11-01", deliverOn: null, noPo: false },
      pos: [{ poId: "po1", poNumber: "TC-PO-2610-006", poStatus: "SUBMITTED", poLineId: "pl1", poDate: "2026-10-24", deliveryDate: "2026-11-10", supplierRevised: false, qty: 2, received: 0, photoKeys: [] }] },
    { ...base, id: "b", itemCode: "LT-2", description: "Downlight B", plan: { orderOn: "2026-11-02", deliverOn: null, noPo: false }, pos: [] },
  ],
};

const PO = { poId: "po9", poNumber: "TC-PO-2611-001", poStatus: "RECEIVED", poLineId: "pl9", poDate: "2026-11-01", deliveryDate: "2026-11-05", supplierRevised: false, qty: 1, received: 0, photoKeys: [] };
const FURNITURE = {
  ...LINES,
  lines: [
    { ...base, id: "sofa", itemCode: "SOF-GEN-3S", description: "3 seater sofa", itemGroup: "RENOVATION", categoryCode: "FURNITURE", subCode: "SOFA", variantCategory: "SOFA", qty: 2, pos: [],
      variants: { colourId: "PC1461-02", fabricId: "PC1461", fabricCode: "PC1461-02", colourLabel: "PC1461-02", fabricLabel: "PC1461", seatHeight: "24", legHeight: "Default" },
      variantText: "PC1461-02 / SEAT 24 / LEG DEFAULT", plan: { orderOn: null, deliverOn: null, noPo: false } },
    { ...base, id: "bed", itemCode: "BED-HKA-1003-(K)", description: "Bedframe K", itemGroup: "RENOVATION", categoryCode: "FURNITURE", subCode: "BEDFRAME", variantCategory: "BEDFRAME", qty: 1, pos: [PO],
      variants: { fabricCode: "PC1461-01", divanHeight: '4"', legHeight: '1"', gap: '4"', totalHeight: '9"' },
      variantText: 'PC1461-01 / DIVAN 4" + LEG 1" / GAP 4" / T.Heights 9"', plan: { orderOn: null, deliverOn: null, noPo: false } },
    { ...base, id: "lt", itemCode: "LT-9", description: "Downlight", variantCategory: "LIGHTING", pos: [], plan: { orderOn: null, deliverOn: null, noPo: false } },
  ],
};


const SITE = {
  ready: true, areas: ["Kitchen"],
  deliveries: [{ type: "delivery_order", id: "d1", no: "TC-DO-2610-003", at: "2026-10-24T06:31:00Z", status: "DELIVERED", from: "TC-SO-1", poNumber: null, poIds: [], areas: ["Kitchen"],
    lines: [{ soItemId: "a", poLineId: null, qty: 1 }], photos: [] }],
};

function renderTab(): void {
  // jsdom has no ResizeObserver; width 0 keeps the table layout.
  globalThis.ResizeObserver ??= class { observe(): void {} disconnect(): void {} unobserve(): void {} } as unknown as typeof ResizeObserver;
  const props = { projectId: 7, canWrite: true, today: "2026-10-24", onDone: vi.fn(), onError: vi.fn() } as unknown as BetaTabProps;
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BetaPoTab {...props} /></MemoryRouter></QueryClientProvider>);
}


// These are Dream Crafter screens: dates read day first (YH, 11 Nov 2026).
beforeAll(() => setDayFirst(true));
afterAll(() => setDayFirst(false));

describe("PO tab", () => {
  it("is plain text until Edit, then the fields open and the band can set every line's date", async () => {
    renderTab();
    const region = await screen.findByRole("region", { name: "Sales order lines" });
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(region).queryByLabelText(/Processing date/)).toBeNull();
    // One line PO cell: number and short date.
    expect(within(region).getByText("TC-PO-2610-006")).toBeTruthy();
    expect(within(region).getAllByText("24-10").length).toBeGreaterThan(0);
    // One band per category, no sub-category band: processing differs between the lines (their span), delivery is set
    // on the PO line only.
    expect(within(region).queryByText("Downlights")).toBeNull();
    expect(within(region).getAllByText("01-11 - 02-11").length).toBe(1);
    expect(within(region).getAllByText("10-11, 1 not set").length).toBe(1);
    // DO: the delivery order that carried line a, a link to it; line b has none yet.
    expect(await within(region).findByText("TC-DO-2610-003")).toBeTruthy();
    expect(within(region).getAllByText("Not yet").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // SKU, qty and supplier cannot be changed here (owner, 05-11-2026): the remark and dates can.
    expect(within(region).queryByLabelText(/^Qty for/)).toBeNull();
    expect(within(region).queryByRole("button", { name: /^Change SKU/ })).toBeNull();
    expect(within(region).queryByLabelText(/^Supplier for/)).toBeNull();
    expect(within(region).queryByRole("columnheader", { name: "Supplier" })).toBeNull();
    expect(within(region).getAllByRole("button", { name: /Add a remark to/ }).length).toBe(2);
    // The PO's own date is changed in the PO: the number opens its editor.
    expect(within(region).queryByLabelText("PO date of TC-PO-2610-006")).toBeNull();
    expect(within(region).getByRole("link", { name: "TC-PO-2610-006" }).getAttribute("href")).toBe("/scm/purchase-orders/po1?edit=1");

    const all = within(region).getByLabelText("Delivery date for every line of Lighting");
    fireEvent.change(all, { target: { value: "2026-11-20" } });
    await waitFor(() => expect(h.patches.length + h.puts.length).toBe(2));
    expect(h.patches).toEqual([["/mfg-purchase-orders/po1/items/pl1", { deliveryDate: "2026-11-20" }]]);
    expect(h.puts).toEqual([["/api/beta/projects/7/line-plans", { itemIds: ["b"], deliverOn: "2026-11-20" }]]);
    // Both lines show the band's date at once, before any reload answers.
    await waitFor(() => expect(within(region).getByLabelText("Delivery date for LT-2")).toHaveProperty("value", "2026-11-20"));
    expect(within(region).getByLabelText("Delivery date on TC-PO-2610-006 for LT-1")).toHaveProperty("value", "2026-11-20");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("picks a sofa's and a bedframe's variants; a line with no variant options has nothing to pick; the PO line is flagged, no VO", async () => {
    h.furniture = true;
    h.patches.length = 0;
    renderTab();
    const region = await screen.findByRole("region", { name: "Sales order lines" });
    expect(within(region).getByText("PC1461-02 / SEAT 24 / LEG DEFAULT")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Two variant buttons: the sofa and the bedframe; the lighting line (no options) stays text.
    expect(within(region).getAllByRole("button", { name: /^Change variants of/ })).toHaveLength(2);

    fireEvent.click(within(region).getByRole("button", { name: "Change variants of SOF-GEN-3S" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick for SOFA" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(region).getByText("PC1461-03 / SEAT 24 / LEG DEFAULT")).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "Change variants of BED-HKA-1003-(K)" }));
    expect(screen.getByText(/TC-PO-2611-001 already buys this line/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick for BEDFRAME" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Fabric PC1461-02 -> PC1461-03/)).toBeTruthy();
    expect(within(dialog).getByText(/no VO, and its PO line is flagged/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The PO line is flagged for purchasing.")).toBeTruthy();
    expect(h.patches).toEqual([
      ["/renovation-so-info/TC-SO-1/lines/sofa/spec", { variants: { colourId: "PC1461-03", fabricId: "PC1461", fabricCode: "PC1461-03", colourLabel: "PC1461-03", fabricLabel: "PC1461", seatHeight: "24", legHeight: "Default" } }],
      ["/renovation-so-info/TC-SO-1/lines/bed/spec", { variants: { fabricCode: "PC1461-01", divanHeight: '6"', legHeight: '1"', gap: '4"', totalHeight: '11"' } }],
    ]);
    h.furniture = false;
  });

  it("shows each line's stock from the coverage the sales order page reads", async () => {
    h.furniture = true;
    h.coverage = [{ id: "sofa", stock_state: "stock", coverage_po: null, coverage_eta: null, ready_source_pos: [], stock_status_effective: "READY" }];
    renderTab();
    expect(await screen.findByText("READY")).toBeTruthy();
    h.coverage = [];
    h.furniture = false;
  });

  it("moves a column by dragging its header, and Reset columns puts it back", async () => {
    renderTab();
    const region = await screen.findByRole("region", { name: "Sales order lines" });
    const heads = (): (string | null)[] => within(region).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads()[0]).toBe("SKU");
    fireEvent.pointerDown(within(region).getByRole("columnheader", { name: "PO" }));
    const sku = within(region).getByRole("columnheader", { name: "SKU" });
    fireEvent.pointerEnter(sku);
    fireEvent.pointerUp(sku);
    expect(heads()[0]).toBe("PO");
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(heads()[0]).toBe("SKU");
  });

  it("locks the variants of a line with goods received", async () => {
    h.furniture = true;
    PO.received = 1;
    renderTab();
    const region = await screen.findByRole("region", { name: "Sales order lines" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(within(region).queryByRole("button", { name: "Change variants of BED-HKA-1003-(K)" })).toBeNull();
    expect(within(region).getByRole("button", { name: "Change variants of SOF-GEN-3S" })).toBeTruthy();
    PO.received = 0;
    h.furniture = false;
  });
});

describe("PO tab head (owner, 07-11-2026)", () => {
  it("has Export PDF and no Close all, Export, Quantity helper or Create PO", async () => {
    h.furniture = false;
    renderTab();
    expect(await screen.findByRole("button", { name: "Export PDF" })).toBeTruthy();
    for (const name of [/Close all/, /Open all/, /^Export$/, /Quantity helper/, /Create PO/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });
  it("Export PDF downloads each sales order", async () => {
    h.furniture = false;
    h.pdf.length = 0;
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Export PDF" }));
    await waitFor(() => expect(h.pdf).toEqual([[{ docNo: "TC-SO-1", status: "CONFIRMED", voLocked: true, renovation: true }]]));
  });
});
