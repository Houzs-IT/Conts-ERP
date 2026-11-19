import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { FloatRow, PaymentRequest, Receipt } from "./claimsQueries";

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
  createdAt: "2026-10-20T00:00:00Z", lines: [{ id: "L1", department: "supply", unitId: null, maintenanceIssueId: null, projectId: 7, accountCode: "601-0001", amountSen: 500000, description: "Cabinet deposit" }],
  files: [], vouchers: [],
};
/* Staff claims paid back by finance, listed on Payment requests beside the requests (chew, 16 Nov 2026). */
let claims: Receipt[] = [];
let requests: PaymentRequest[] | null = null;
const claim = (status: Receipt["status"]): Receipt => ({
  id: "R1", receiptNo: "CLM-2611-001", submitterUserId: "u5", submitterName: "Jiaxin", floatId: null, spendDate: "2026-11-08", amountSen: 10090,
  vendorName: "OpenAI OpCo, LLC", note: null, status, rejectReason: null, checkedAt: null, checkedBy: null, topUpPvId: null, paybackPvId: null, replacesId: null,
  source: "web", lines: [{ id: "RL1", department: "shared", unitId: null, maintenanceIssueId: null, projectId: null, accountCode: status === "CHECKED" ? "906-0000" : null, amountSen: 10090, description: "ChatGPT" }],
  files: [], bank: { bankName: "Maybank", accountNo: "1234567890", accountName: null, fromClaim: true, differsFromSaved: false },
});
/* The sub-departments a line names (SOP 1.1). */
vi.mock("./subDepartmentQueries", () => ({ useSubDepartments: () => ({ data: { subDepartments: [] } }) }));
vi.mock("./claimsQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./claimsQueries")>()),
  useFloats: () => ({ data: { floats, totals: { floatSen: 150000, balanceSen: 13000, waitingCheckSen: 4500 } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useFinanceReceipts: () => ({ data: { receipts: claims }, isLoading: false, isError: false }),
  useOverrides: () => ({ data: { overrides: [] } }),
  usePaymentRequests: () => ({ data: { requests: requests ?? [request] }, isLoading: false, isError: false }),
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
import { PaymentRequestDetail, PaymentRequests } from "./PaymentRequests";

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
  it("Make voucher opens the New voucher form filled in from the request, the account left to choose (chew, 16 Nov 2026)", async () => {
    act.mockClear();
    const Probe = () => { const st = useLocation().state as { claimsPrefill?: { payeeName: string; lines: Array<{ paymentRequestId: string; amountSen: number }> } } | null; return <div>{`opened ${st?.claimsPrefill?.payeeName} ${st?.claimsPrefill?.lines.map((l) => `${l.paymentRequestId}:${l.amountSen}`).join(",")}`}</div>; };
    render(<MemoryRouter initialEntries={["/r"]}><Routes><Route path="/r" element={<PaymentRequests />} /><Route path="/scm/payment-vouchers/new" element={<Probe />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByText("Make voucher"));
    expect(await screen.findByText("opened ACE Q1:500000")).toBeTruthy();
    expect(act).not.toHaveBeenCalled();
  });
  it("a staff claim is on the list too: checked first, then paid by voucher with the requests (chew, 16 Nov 2026)", async () => {
    claims = [claim("HANDED_IN")];
    const { unmount } = render(<MemoryRouter><PaymentRequests /></MemoryRouter>);
    expect(screen.getByText("CLM-2611-001")).toBeTruthy();
    expect(screen.getByText("Check")).toBeTruthy();
    expect(screen.getAllByText("Make voucher")).toHaveLength(1);
    unmount();
    claims = [claim("CHECKED")];
    const Probe = () => { const st = useLocation().state as { claimsPrefill?: { lines: Array<{ staffReceiptId?: string; accountCode?: string | null }> } } | null; return <div>{`opened ${st?.claimsPrefill?.lines.map((l) => `${l.staffReceiptId}:${l.accountCode}`).join(",")}`}</div>; };
    render(<MemoryRouter initialEntries={["/r"]}><Routes><Route path="/r" element={<PaymentRequests />} /><Route path="/scm/payment-vouchers/new" element={<Probe />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getAllByText("Make voucher").at(-1)!);
    expect(await screen.findByText("opened R1:906-0000")).toBeTruthy();
    claims = [];
  });
  it("a utility request is paid by voucher against its accrual, never an AP invoice (chew, 16 Nov 2026)", async () => {
    requests = [{ ...request, id: "QU", requestNo: "PRQ-2611-009", type: "PAYMENT", payeeName: "TNB", fromBills: true, owesFormalInvoice: false,
      lines: [{ id: "LU", department: "rental", unitId: "U1", maintenanceIssueId: null, projectId: null, accountCode: null, amountSen: 31425, description: "Electricity 2026-11 2102353477XX" }] }];
    const Probe = () => { const st = useLocation().state as { claimsPrefill?: { lines: Array<{ accountCode?: string | null }> } } | null; return <div>{`opened ${st?.claimsPrefill?.lines.map((l) => l.accountCode).join(",")}`}</div>; };
    render(<MemoryRouter initialEntries={["/r"]}><Routes><Route path="/r" element={<PaymentRequests />} /><Route path="/scm/payment-vouchers/new" element={<Probe />} /></Routes></MemoryRouter>);
    /* Utility bills are on their own tab (chew, 18 Nov 2026). */
    expect(screen.queryByText("PRQ-2611-009")).toBeNull();
    fireEvent.click(screen.getByText(/^Utility bills/));
    expect(screen.queryByText("Make AP invoice")).toBeNull();
    fireEvent.click(screen.getByText("Make voucher"));
    expect(await screen.findByText("opened 420-0010")).toBeTruthy();
    requests = null;
  });
  it("double-clicking a request opens it on its own page (chew, 19 Nov 2026)", async () => {
    render(<MemoryRouter initialEntries={["/r"]}><Routes><Route path="/r" element={<PaymentRequests />} /><Route path="/scm/payment-requests/:kind/:id" element={<PaymentRequestDetail />} /></Routes></MemoryRouter>);
    fireEvent.doubleClick(screen.getByText("PRQ-2610-001"));
    expect(await screen.findByRole("heading", { name: "PRQ-2610-001" })).toBeTruthy();
    expect(screen.getByText("Lines (1)")).toBeTruthy();
  });
  it("without Ledger full there is no Make voucher", () => {
    full = false;
    render(<MemoryRouter><PaymentRequests /></MemoryRouter>);
    expect(screen.queryByText("Make voucher")).toBeNull();
    full = true;
  });
});
