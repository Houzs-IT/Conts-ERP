import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FloatRow, PaymentRequest } from "./claimsQueries";

// Finance's petty cash and payment requests (Conts; SOP 3.2, 6). Pinned: the overview's totals and a low float; the
// a new float sends the account chosen, only free ones offered; a float without its account is flagged; a rejection is not sent without a reason; who sees which action.
const act = vi.fn(async (p: unknown) => (p as { path: string }).path.endsWith("/voucher") ? { pvId: "PV1" } : { ok: true });
let full = true;
const floats: FloatRow[] = [
  { id: "F1", departmentId: "d1", departmentName: "Maintenance", keeperUserId: "u1", keeperName: "Ah Keong", accountCode: "315-0101", accountName: "PETTY CASH - AMIN", openingSen: 0, openingOn: null, floatSen: 100000, warnPct: 20, active: true,
    balanceSen: 15000, low: true, lastTopUpOn: "2026-10-01", topUpRequested: true, waitingCheckSen: 4500, waitingCheckCount: 2 },
  { id: "F2", departmentId: "d2", departmentName: "Cleaning", keeperUserId: "u2", keeperName: "Siti", accountCode: null, accountName: null, openingSen: 0, openingOn: null, floatSen: 50000, warnPct: 20, active: true,
    balanceSen: -2000, low: true, lastTopUpOn: null, topUpRequested: false, waitingCheckSen: 0, waitingCheckCount: 0 },
];
const request: PaymentRequest = {
  id: "Q1", requestNo: "PRQ-2610-001", type: "DEPOSIT", requesterUserId: "u3", requesterName: "Wei Wen", supplierId: "S1", payeeName: "ACE", payeeToCheck: false,
  purchaseOrderId: null, wantedOn: null, owesFormalInvoice: true, note: null, amountSen: 500000, status: "SUBMITTED", reason: null, decidedBy: null,
  createdAt: "2026-10-20T00:00:00Z", lines: [{ department: "supply", unitId: null, maintenanceIssueId: null, projectId: 7, accountCode: "601-0001", amountSen: 500000, description: "Cabinet deposit" }],
  files: [], vouchers: [],
};
vi.mock("./claimsQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./claimsQueries")>()),
  useFloats: () => ({ data: { floats, totals: { floatSen: 150000, balanceSen: 13000, waitingCheckSen: 4500 } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useFinanceReceipts: () => ({ data: { receipts: [] }, isLoading: false, isError: false }),
  useOverrides: () => ({ data: { overrides: [] } }),
  usePaymentRequests: () => ({ data: { requests: [request] }, isLoading: false, isError: false }),
  useFinanceAction: () => ({ mutateAsync: act, isPending: false }),
}));
vi.mock("./ClaimsParts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ClaimsParts")>()),
  usePettyOptions: () => ({ data: {
    departments: [{ id: "d3", name: "Renovation", kind: "team", side: "supply" }], staff: [{ id: "u9", name: "Alex", departmentId: "d3" }],
    banks: [{ code: "310-0010", name: "MAYBANK" }], expenseAccounts: [], writeOffAccounts: [],
    floatAccounts: [{ code: "315-0100", name: "PETTY CASH - ALEX (RENO)", floatId: null }, { code: "315-0101", name: "PETTY CASH - AMIN", floatId: "F1" }],
  } }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: (k: string) => (k === "scm.payment_voucher.approve" ? full : true) }) }));
const promptFn = vi.fn(async () => null as string | null);
vi.mock("../vendor/scm/components/PromptDialog", () => ({ usePrompt: () => promptFn }));
const chooseFn = vi.fn(async (_o: { options: { value: string }[] }) => "310-0010" as string | null);
vi.mock("../vendor/scm/components/ChoiceDialog", () => ({ useChoice: () => chooseFn }));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => async () => true }));

import { PettyCash } from "./PettyCash";
import { PaymentRequests } from "./PaymentRequests";

describe("Petty cash overview", () => {
  it("shows the totals, the floats running low, and a balance below zero in the danger colour", () => {
    render(<MemoryRouter><PettyCash /></MemoryRouter>);
    expect(screen.getByText("Maintenance")).toBeTruthy();
    expect(screen.getAllByText("low")).toHaveLength(2);
    expect(screen.getByText("2 running low")).toBeTruthy();
    expect(screen.getByText("−RM 20.00").className).toContain("text-err");
    expect(screen.getByText("Top-up asked for")).toBeTruthy();
  });
  it("shows each float's account, and flags a float without one", () => {
    render(<MemoryRouter><PettyCash /></MemoryRouter>);
    expect(screen.getByText("315-0101 PETTY CASH - AMIN")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Cleaning has no petty cash account");
  });
  it("a new float sends the account chosen (only accounts no float uses) and the cash the keeper already holds", async () => {
    act.mockClear();
    chooseFn.mockClear();
    chooseFn.mockResolvedValueOnce("d3").mockResolvedValueOnce("u9").mockResolvedValueOnce("315-0100");
    promptFn.mockResolvedValueOnce("500").mockResolvedValueOnce("350");
    render(<MemoryRouter><PettyCash /></MemoryRouter>);
    fireEvent.click(screen.getByText("New float"));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ path: "/accounting/petty-cash/floats", body: { departmentId: "d3", keeperUserId: "u9", accountCode: "315-0100", floatSen: 50000, openingSen: 35000 }, method: "POST" }));
    expect(chooseFn.mock.calls[2][0].options.map((o) => o.value)).toEqual(["315-0100"]);
  });
  it("only Ledger full sees New float", () => {
    full = false;
    render(<MemoryRouter><PettyCash /></MemoryRouter>);
    expect(screen.queryByText("New float")).toBeNull();
    full = true;
  });
});

describe("Payment requests", () => {
  it("a rejection is not sent without a reason", async () => {
    act.mockClear();
    promptFn.mockResolvedValueOnce(null);
    render(<MemoryRouter><PaymentRequests /></MemoryRouter>);
    fireEvent.click(screen.getByText("Reject"));
    await waitFor(() => expect(promptFn).toHaveBeenCalled());
    expect(act).not.toHaveBeenCalled();
  });
  it("making the voucher asks for the bank and sends it", async () => {
    act.mockClear();
    render(<MemoryRouter><PaymentRequests /></MemoryRouter>);
    fireEvent.click(screen.getByText("Make voucher"));
    await waitFor(() => expect(act).toHaveBeenCalledWith({ path: "/accounting/payment-requests/Q1/voucher", body: { bankAccountCode: "310-0010" }, method: "POST" }));
  });
  it("without Ledger full there is no Make voucher", () => {
    full = false;
    render(<MemoryRouter><PaymentRequests /></MemoryRouter>);
    expect(screen.queryByText("Make voucher")).toBeNull();
    full = true;
  });
});
