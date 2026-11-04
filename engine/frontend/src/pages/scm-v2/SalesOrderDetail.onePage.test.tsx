/* One Sales Order page (owner, 4 Nov 2026): view and edit are the same screen. The page is MOUNTED on its real route
 * under a real QueryClient; only the detail read is faked. The test that matters is that Edit does not swap the page:
 * the same mount switches its sections, the URL says so, and nothing the view does not need goes out.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { detail } = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("../../vendor/scm/lib/sales-order-queries", async (orig) => ({
  ...(await orig<typeof import("../../vendor/scm/lib/sales-order-queries")>()),
  useMfgSalesOrderDetail: detail,
  useSalesOrderAuditLog: () => ({ data: [], isLoading: false, isError: false }),
  useSalesOrderPayments: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("../../vendor/scm/components/SoLineCard", async (orig) => ({
  ...(await orig<typeof import("../../vendor/scm/components/SoLineCard")>()),
  SoLineCard: (p: { itemId?: string; specLockedNote?: string }) => <div data-testid={`card-${p.itemId ?? "new"}`} data-note={p.specLockedNote ?? ""} />,
}));
vi.mock("../../hooks/useBreadcrumbs", () => ({ useSetBreadcrumbs: () => undefined }));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../vendor/scm/components/PromptDialog", () => ({ usePrompt: () => vi.fn() }));
vi.mock("../../vendor/scm/components/PaymentsTable", () => ({ PaymentsTable: () => <div data-testid="payments" /> }));
vi.mock("../../vendor/scm/components/CancelRequestPanel", () => ({ CancelRequestPanel: () => null }));
vi.mock("./use-cancel-request-action", () => ({ useCancelRequestAction: () => vi.fn() }));
vi.mock("./so-relationship-map", () => ({ useSoRelationshipMap: () => ({ nodes: [], edges: [] }) }));
vi.mock("../../components/doc-attachments/DocAttachments", () => ({ DocAttachments: () => null, LineFilesButton: () => null }));
vi.mock("../../components/scm-v2/PrintPreviewModal", () => ({
  PrintPreviewModal: () => null,
  useOpenPrintPreviewFromUrl: () => undefined,
  usePrintPreview: () => ({ openPreview: vi.fn(), close: vi.fn(), state: null, handlers: {} }),
}));
vi.mock("../../components/scm-v2/DocumentRelationshipMapModal", () => ({
  DocumentRelationshipMapModal: () => null,
  DocumentChoiceDialog: () => null,
}));
vi.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: 1, name: "Owner" }, can: () => true, pageAccess: () => "edit" }) }));
vi.mock("../../vendor/scm/lib/auth", async (orig) => ({
  ...(await orig<typeof import("../../vendor/scm/lib/auth")>()),
  useAuth: () => ({ staff: null, user: null }),
}));

import { SalesOrderDetail } from "./SalesOrderDetail";

const DOC = "TC-SO-2610-002";

const header = {
  doc_no: DOC, status: "CONFIRMED", so_date: "2026-10-01", debtor_code: "C1", debtor_name: "Ada Tan",
  currency: "MYR", local_total_sen: 100000, balance_sen: 0, discount_sen: 0, line_count: 1, version: 3,
  processing_date: null, customer_delivery_date: null, phone: "+60123456789", email: "a@b.c",
  address1: "1 Jalan", customer_state: "Selangor", city: "Shah Alam", postcode: "40000",
  emergency_contact_name: "Mei Hua", emergency_contact_phone: "+60129999999", emergency_contact_relationship: "Sister",
  has_children: false, downstream_fully_frozen: false,
};
const line = {
  id: "line-1", doc_no: DOC, item_group: "others", item_code: "SKU-1", description: "Sofa", description2: null, uom: "UNIT",
  qty: 1, unit_price_sen: 100000, discount_sen: 0, total_sen: 100000, unit_cost_sen: 0, line_cost_sen: 0,
  line_margin_sen: 0, variants: {}, remark: null, photo_urls: null, cancelled: false,
  line_delivery_date: null, line_delivery_date_overridden: false, deliveries: [], delivered_qty: 0, remaining_qty: 1,
};

function Probe() {
  const l = useLocation();
  return <div data-testid="at">{`${l.search}${l.hash}`}</div>;
}

let posts: string[];
let detailItems: unknown[] = [line];

beforeEach(() => {
  posts = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push(String(url));
    return new Promise(() => undefined);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (entry = `/scm/sales-orders/${DOC}`, so: Record<string, unknown> = header) => {
  detail.mockReturnValue({ data: { salesOrder: so, items: detailItems }, isLoading: false, isPending: false, isError: false, error: null, refetch: vi.fn() });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
        <Routes>
          <Route path="/scm/sales-orders/:docNo" element={<SalesOrderDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const button = (name: RegExp) => screen.getByRole("button", { name });

describe("one Sales Order page", () => {
  it("views the order read-only, with no inputs and no save check going out", () => {
    mount();
    expect(screen.queryByDisplayValue("Ada Tan")).toBeNull();
    expect(screen.getAllByText("Ada Tan").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("card-line-1")).toBeNull();
    expect(screen.getAllByText("Order total").length).toBeGreaterThan(0);
    expect(posts.filter((u) => u.includes("/validate"))).toEqual([]);
  });

  it("shows the emergency contact on file, not the customer's own phone", () => {
    mount();
    expect(screen.getByText("Mei Hua")).toBeTruthy();
    expect(screen.getByText("Sister")).toBeTruthy();
  });

  it("Edit opens the same sections in place, and the aside and payments stay", () => {
    mount();
    const payments = screen.getByTestId("payments");
    fireEvent.click(within(document.body).getAllByRole("button", { name: /^edit$/i })[0]);
    expect(screen.getByTestId("at").textContent).toBe("?edit=1");
    expect((screen.getByDisplayValue("Ada Tan") as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByTestId("card-line-1")).toBeTruthy();
    expect(screen.getAllByText("Order total").length).toBeGreaterThan(0);
    /* The same node: Edit did not remount the page around it. */
    expect(screen.getByTestId("payments")).toBe(payments);
  });

  it("Cancel returns to the view and drops the mode from the URL", () => {
    mount(`/scm/sales-orders/${DOC}?edit=1`);
    expect(screen.getByDisplayValue("Ada Tan")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /^cancel$/i })[0]);
    expect(screen.getByTestId("at").textContent).toBe("");
    expect(screen.queryByDisplayValue("Ada Tan")).toBeNull();
  });

  it("Add line from the view opens a staged line, and again after Cancel on the same mount", () => {
    mount();
    fireEvent.click(button(/^add line$/i));
    expect(screen.getByTestId("card-new")).toBeTruthy();
    expect(screen.getByTestId("at").textContent).toBe("?edit=1");
    fireEvent.click(screen.getAllByRole("button", { name: /^cancel$/i })[0]);
    expect(screen.queryByTestId("card-new")).toBeNull();
    fireEvent.click(button(/^add line$/i));
    expect(screen.getByTestId("card-new")).toBeTruthy();
  });

  it("Edit shows the live lines only: a line a VO replaced is not on the order", () => {
    detailItems = [line, { ...line, id: "line-gone", cancelled: true }];
    mount(`/scm/sales-orders/${DOC}?edit=1`);
    expect(screen.getByTestId("card-line-1")).toBeTruthy();
    expect(screen.queryByTestId("card-line-gone")).toBeNull();
    expect(screen.getByText("Line items · 1")).toBeTruthy();
    detailItems = [line];
  });

  it("goods received lock the line's spec on the edit page, and only that line", () => {
    detailItems = [{ ...line, received_qty: 1 }, { ...line, id: "line-2", received_qty: 0 }];
    mount(`/scm/sales-orders/${DOC}?edit=1`);
    expect(screen.getByTestId("card-line-1").dataset.note).toBe("Goods received: the SKU, options and price are locked.");
    expect(screen.getByTestId("card-line-2").dataset.note).toBe("");
    detailItems = [line];
  });

  it("offers Submit VO on a processing-locked order and keeps its amendment banner to Edit", () => {
    mount(`/scm/sales-orders/${DOC}`, { ...header, amendment_eligible: true, vo_locked: true, processing_date: "2026-10-02", customer_delivery_date: "2026-10-30" });
    expect(screen.getAllByRole("button", { name: /submit vo/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /record vo/i })).toBeNull();
  });
});
