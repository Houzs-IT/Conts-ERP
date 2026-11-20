/* A Sales Order with an OPEN cancellation request says so on the list row and
 * in the quick-view drawer header — before, only the full detail page's
 * CancelRequestPanel showed it. One inbox query (GET /cancel-requests?scope=open)
 * feeds every row; same harness as soQuickViewStockPill.test.tsx. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ cancelScopes: [] as string[] }));

vi.mock("../../vendor/scm/lib/authed-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../vendor/scm/lib/authed-fetch")>()),
  authedFetch: vi.fn(async () => ({})),
}));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, permissions: ["*"] }, can: () => true, pageAccess: () => "edit" }),
}));
vi.mock("../../auth/salesAccess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth/salesAccess")>()),
  canViewScmCosting: () => false,
}));
vi.mock("../../hooks/useStaffLookup", () => ({
  useStaffLookup: () => ({ nameOf: (_a: unknown, _b: unknown, fallback: string) => fallback }),
}));
const soRow = (doc_no: string, debtor_name: string) => ({
  doc_no, so_date: "2026-09-12", debtor_name, debtor_code: null, agent: "NICO", salesperson_id: null,
  sales_location: "KL", ref: null, branding: "HOUZS", status: "CONFIRMED", on_hold: null,
  local_total_sen: 1000, balance_sen: 1000, paid_sen: 0, paid_total_sen: 0, currency: "MYR",
  processing_date: null, customer_delivery_date: null, phone: null, email: null, address1: null,
  address2: null, city: null, postcode: null, customer_state: null, payment_method: null, lines: [],
});
vi.mock("../../vendor/scm/lib/sales-order-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../vendor/scm/lib/sales-order-queries")>()),
  useMfgSalesOrdersPaged: () => ({
    data: {
      salesOrders: [soRow("HC-SO-000001", "PENDING CUSTOMER"), soRow("HC-SO-000002", "CALM CUSTOMER")],
      total: 2, page: 1, pageSize: 25, statusCounts: { all: 2 },
    },
    isLoading: false, isFetching: false, isPlaceholderData: false, error: null,
  }),
  useEnrichedSoListRows: (rows: unknown[]) => rows,
  useSoLineCoverage: () => ({ data: undefined }),
  useMfgSalesOrderDetail: () => ({ data: { items: [] }, isLoading: false, error: null }),
  useUpdateMfgSalesOrderStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../../vendor/scm/lib/document-cancel-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../vendor/scm/lib/document-cancel-queries")>()),
  useCancelRequests: (scope: string) => {
    h.cancelScopes.push(scope);
    return {
      data: {
        requests: [
          { id: "c1", doc_type: "SO", doc_key: "HC-SO-000001", doc_number: "HC-SO-000001", status: "REQUESTED" },
          // A Purchase Order whose id happens to equal the second SO's number must not flag it.
          { id: "c2", doc_type: "PO", doc_key: "HC-SO-000002", doc_number: "PO-1", status: "REQUESTED" },
        ],
      },
    };
  },
}));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../../vendor/scm/components/ChoiceDialog", () => ({ useChoice: () => vi.fn() }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../vendor/scm/components/PromptDialog", () => ({ usePrompt: () => vi.fn() }));
vi.mock("../../components/scm-v2/PrintChainProvider", () => ({ usePrintDocument: () => vi.fn() }));
vi.mock("../../hooks/useBranding", () => ({
  useBranding: () => ({ companyName: "HOUZS CENTURY SDN BHD", companyCode: "HOUZS" }),
}));

import { MfgSalesOrdersListV2 } from "./MfgSalesOrdersListV2";
import { ToastProvider } from "../../hooks/useToast";

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/scm/sales-orders"]}>
        <ToastProvider>
          <MfgSalesOrdersListV2 />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const tableRowOf = (debtor: string) =>
  screen.getAllByText(debtor).map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => !!tr)!;

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.cancelScopes = [];
});

describe("SO list: pending cancellation marker", () => {
  it("flags the row with an open request and not the row without one, from the one open-scope query", () => {
    mount();
    expect(within(tableRowOf("PENDING CUSTOMER")).getByText("Cancel requested")).toBeTruthy();
    expect(within(tableRowOf("CALM CUSTOMER")).queryByText("Cancel requested")).toBeNull();
    expect(new Set(h.cancelScopes)).toEqual(new Set(["open"]));
  });

  it("shows the marker in the drawer header next to the status pill", async () => {
    mount();
    fireEvent.click(within(tableRowOf("PENDING CUSTOMER")).getByText("PENDING CUSTOMER"));
    const drawer = await screen.findByRole("dialog", { name: /Sales order HC-SO-000001/ });
    expect(within(drawer).getByText("Cancel requested")).toBeTruthy();
  });
});
