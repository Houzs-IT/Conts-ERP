import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The Ledger setup page (finance phase 1, spec 3.7 and 3.8): the day the books start and the fiscal year end.
const saveAsync = vi.fn(async (p: unknown) => p);
let settings: { ledgerStartDate: string | null; fiscalYearEndMonth: number } | undefined = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
let loadFailed = false;
let canPost = true;
const confirmFn = vi.fn(async () => true);
vi.mock("./ledgerSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledgerSettings")>()),
  useLedgerSettings: () => (loadFailed
    ? { data: undefined, isLoading: false, isError: true, isSuccess: false }
    : { data: settings, isLoading: false, isError: false, isSuccess: true }),
  useSaveLedgerSettings: () => ({ mutateAsync: saveAsync, isPending: false }),
  useSetupStatus: () => ({ isSuccess: true, data: {
    ready: false,
    roles: [
      { role: "AR", accountCode: "300-0000", problem: null },
      { role: "BANK_DEFAULT", accountCode: "320-0000", problem: "not_money" },
    ],
    itemGroups: [{ group: "SOFA", missing: ["sales_return_account"] }],
    banksWithoutLetter: ["310-0010"],
    ledgerStartDate: null,
  } }),
  useSetRole: () => ({ mutateAsync: setRoleAsync, isPending: false }),
}));
const setRoleAsync = vi.fn(async (p: unknown) => p);
vi.mock("../vendor/scm/lib/accounting-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../vendor/scm/lib/accounting-queries")>()),
  useAccounts: () => ({ data: { accounts: [
    { account_code: "300-0000", account_name: "DEBTORS", account_type: "ASSET", parent_code: null, is_active: true, acc_money: false },
    { account_code: "310-0020", account_name: "CIMB", account_type: "ASSET", parent_code: null, is_active: true, acc_money: true },
    { account_code: "320-0000", account_name: "PETTY", account_type: "ASSET", parent_code: null, is_active: true, acc_money: false },
  ] } }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: () => canPost }) }));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));

import { LedgerSetup } from "./LedgerSetup";

describe("Ledger setup — Books", () => {
  it("shows the saved settings, and saves the start date and the year-end month together", async () => {
    saveAsync.mockClear();
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect((screen.getByLabelText("Fiscal year ends in") as HTMLSelectElement).value).toBe("8");
    expect(screen.getByText(/No start date yet/)).toBeTruthy();
    const start = screen.getByLabelText("Books start on") as HTMLInputElement;
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "20261201" } });
    fireEvent.blur(start);
    fireEvent.change(screen.getByLabelText("Fiscal year ends in"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 12 }));
  });

  it("a saved start date reads back", () => {
    settings = { ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 8 };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect((screen.getByLabelText("Books start on") as HTMLInputElement).value).toBe("2026/12/01");
    expect(screen.queryByText(/No start date yet/)).toBeNull();
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });

  /* The start date decides what posts (spec 3.8): it is never cleared or moved by accident. */
  it("a failed load saves nothing — the form is not a statement of the settings", () => {
    saveAsync.mockClear();
    loadFailed = true;
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect((screen.getByText("Save").closest("button") as HTMLButtonElement).disabled).toBe(true);
    loadFailed = false;
  });

  it("only what changed is sent: the year end alone leaves the start date alone", async () => {
    saveAsync.mockClear();
    settings = { ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 8 };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Fiscal year ends in"), { target: { value: "12" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ fiscalYearEndMonth: 12 }));
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });

  it("changing a saved start date asks first, and a no saves nothing", async () => {
    saveAsync.mockClear(); confirmFn.mockClear();
    confirmFn.mockResolvedValueOnce(false);
    settings = { ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 8 };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    const start = screen.getByLabelText("Books start on") as HTMLInputElement;
    fireEvent.focus(start);
    fireEvent.change(start, { target: { value: "20270101" } });
    fireEvent.blur(start);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1));
    expect(saveAsync).not.toHaveBeenCalled();
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });

  it("without the post permission the page reads, and says who can change it", () => {
    canPost = false;
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect((screen.getByText("Save").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only someone who can post to the ledger/)).toBeTruthy();
    canPost = true;
  });
});

/* Posting rules (spec 3.4): every automatic posting's account, what is wrong with each, and whether the ledger is
   ready to go live. */
describe("Ledger setup — Posting rules", () => {
  it("says Not ready and why; a rule with a problem is marked; choosing an account saves that rule", async () => {
    setRoleAsync.mockClear();
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.getByText(/1 posting rule needs an account/)).toBeTruthy();
    expect(screen.getByText(/SOFA: sales_return_account/)).toBeTruthy();
    expect(screen.getByText(/310-0010/)).toBeTruthy();
    const bank = screen.getByText("Default bank").closest("tr")!;
    expect(bank.getAttribute("data-problem")).toBe("not_money");
    expect(bank.textContent).toContain("must be a bank or cash account");
    fireEvent.focus(screen.getByLabelText("Default bank account"));
    fireEvent.mouseDown(screen.getByText("310-0020 — CIMB"));
    await waitFor(() => expect(setRoleAsync).toHaveBeenCalledWith({ role: "BANK_DEFAULT", accountCode: "310-0020" }));
  });
});
