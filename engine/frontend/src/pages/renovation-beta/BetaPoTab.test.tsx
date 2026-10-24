/* The PO tab reads as plain text until Edit; a band sets the date of every line in it; the PO cell is one line. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ puts: [] as Array<[string, unknown]>, patches: [] as Array<[string, unknown]> }));

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  const get = async (path: string): Promise<unknown> => {
    if (path.endsWith("/lines")) return LINES;
    if (path.endsWith("/vo")) return { vos: [] };
    throw new Error(`no mock for ${path}`);
  };
  const put = async (path: string, body: unknown): Promise<unknown> => { h.puts.push([path, body]); return { ok: true, plan: {} }; };
  return { ...actual, api: { ...actual.api, get, put } };
});
vi.mock("../../vendor/scm/lib/authed-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../vendor/scm/lib/authed-fetch")>();
  return { ...actual, authedFetch: async (path: string, init?: { body?: string }) => { h.patches.push([path, init?.body ? JSON.parse(init.body) : null]); return {}; } };
});
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));

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

function renderTab(): void {
  // jsdom has no ResizeObserver; width 0 keeps the table layout.
  globalThis.ResizeObserver ??= class { observe(): void {} disconnect(): void {} unobserve(): void {} } as unknown as typeof ResizeObserver;
  const props = { projectId: 7, canWrite: true, today: "2026-10-24", onDone: vi.fn(), onError: vi.fn() } as unknown as BetaTabProps;
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BetaPoTab {...props} /></MemoryRouter></QueryClientProvider>);
}

describe("PO tab", () => {
  it("is plain text until Edit, then the fields open and the band can set every line's date", async () => {
    renderTab();
    const region = await screen.findByRole("region", { name: "Sales order lines" });
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(region).queryByLabelText(/Processing date/)).toBeNull();
    // One line PO cell: number and short date.
    expect(within(region).getByText("TC-PO-2610-006")).toBeTruthy();
    expect(within(region).getAllByText("24 Oct").length).toBeGreaterThan(0);
    // The band: processing differs between the lines, delivery on the PO line vs none.
    expect(within(region).getAllByText("Mixed").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(within(region).getAllByRole("textbox").length).toBeGreaterThan(0);
    expect(within(region).getByLabelText("PO date of TC-PO-2610-006")).toBeTruthy();

    const all = within(region).getByLabelText("Delivery date for every line of Lighting");
    fireEvent.change(all, { target: { value: "2026-11-20" } });
    await waitFor(() => expect(h.patches.length + h.puts.length).toBe(2));
    expect(h.patches).toEqual([["/mfg-purchase-orders/po1/items/pl1", { deliveryDate: "2026-11-20" }]]);
    expect(h.puts).toEqual([["/api/beta/projects/7/lines/b/plan", { deliverOn: "2026-11-20" }]]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(within(region).queryAllByRole("textbox")).toHaveLength(0);
  });
});
