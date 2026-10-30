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
      { role: "AR", accountCode: "300-0000", kind: "any", problem: null },
      { role: "BANK_DEFAULT", accountCode: "320-0000", kind: "money", problem: "not_money" },
      { role: "TRANSIT_EDC", accountCode: "326-0000", kind: "clearing", problem: null },
    ],
    itemGroups: [{ group: "SOFA", missing: ["sales_return_account"] }],
    banksWithoutLetter: ["310-0010"],
    controlsWithChildren: ["301-0000"],
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
    { account_code: "326-0000", account_name: "CARD CLEARING", account_type: "ASSET", parent_code: null, is_active: true, acc_money: false },
    { account_code: "326-0010", account_name: "CARD CLEARING PBB", account_type: "ASSET", parent_code: null, is_active: true, acc_money: false },
  ] } }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: () => canPost }) }));
let openingCheck: Record<string, unknown> | undefined;
vi.mock("./opening", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./opening")>()),
  useOpeningCheck: (enabled: boolean) => (enabled && openingCheck
    ? { isSuccess: true, isError: false, data: openingCheck }
    : { isSuccess: false, isError: false, data: undefined }),
  useImportOpening: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReverseOpening: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));
vi.mock("./EverydayExpense", () => ({ EverydayExpense: () => null }));
vi.mock("./RenovationOpening", () => ({ RenovationOpening: () => null }));

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
    // Conts: a customer control with sub-accounts could not be posted to.
    expect(screen.getByText(/1 customer or supplier control has sub-accounts/)).toBeTruthy();
    expect(screen.getByText(/Controls with sub-accounts/).parentElement!.textContent).toContain("301-0000");
    const bank = screen.getByText("Default bank").closest("tr")!;
    expect(bank.getAttribute("data-problem")).toBe("not_money");
    expect(bank.textContent).toContain("must be a bank or cash account");
    confirmFn.mockClear();
    fireEvent.focus(screen.getByLabelText("Default bank account"));
    /* The money rule offers money only; the clearing rule offers the 326- / 327- clearings only. */
    expect(screen.queryByText("300-0000 — DEBTORS")).toBeNull();
    fireEvent.mouseDown(screen.getByText("310-0020 — CIMB"));
    await waitFor(() => expect(setRoleAsync).toHaveBeenCalledWith({ role: "BANK_DEFAULT", accountCode: "310-0020" }));
    /* Every change asks first — one stray Enter must not move a rule. */
    expect(confirmFn).toHaveBeenCalledTimes(1);
  });

  it("a no to the question saves nothing", async () => {
    setRoleAsync.mockClear(); confirmFn.mockClear();
    confirmFn.mockResolvedValueOnce(false);
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    fireEvent.focus(screen.getByLabelText("Card machine clearing account"));
    expect(screen.queryByText("310-0020 — CIMB")).toBeNull();
    fireEvent.mouseDown(screen.getByText("326-0010 — CARD CLEARING PBB"));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledTimes(1));
    expect(setRoleAsync).not.toHaveBeenCalled();
  });

  it("a rule whose account already carries postings asks again, with what stays behind, then saves", async () => {
    setRoleAsync.mockClear(); confirmFn.mockClear();
    const inUse = Object.assign(new Error("in use"), { status: 409, body: JSON.stringify({ error: "role_in_use", accountCode: "300-0000", balanceSen: 40000, message: "300-0000 already carries 3 posted lines." }) });
    setRoleAsync.mockRejectedValueOnce(inUse);
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    fireEvent.focus(screen.getByLabelText("Trade debtors (customers) account"));
    fireEvent.mouseDown(screen.getByText("310-0020 — CIMB"));
    await waitFor(() => expect(setRoleAsync).toHaveBeenCalledTimes(2));
    expect(confirmFn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(confirmFn.mock.calls[1])).toContain("400.00");
    expect(setRoleAsync).toHaveBeenLastCalledWith({ role: "AR", accountCode: "310-0020", confirm: true });
  });
});

describe("Ledger setup — Opening balances", () => {
  const CHECK = {
    ok: true, openingDay: "2026-11-30", openingJeNo: "JE-2611-0001", openingJeDate: "2026-11-30", trialDebitSen: 150000, trialCreditSen: 150000,
    controls: [
      { role: "AR", accountCode: "300-0000", controlSen: 50000, documentsSen: 40000, erpDocuments: 0 },
      { role: "AP", accountCode: "400-0000", controlSen: 30000, documentsSen: 30000, erpDocuments: 0 },
      { role: "AP_OTHER", accountCode: "405-0000", controlSen: 0, documentsSen: 0, erpDocuments: 0 },
    ],
    banks: [{ accountCode: "310-0001", name: "MAYBANK", balanceSen: 100000 }], balanced: false,
  };

  it("asks for the start date before anything can be imported", () => {
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect(screen.getByText(/Set the day the books start first/)).toBeTruthy();
  });

  it("shows the check in red when AR does not match", () => {
    settings = { ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 8 };
    openingCheck = CHECK;
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect(screen.getByTestId("opening-verdict").textContent).toMatch(/do not agree yet/);
    const debtors = screen.getByText("Trade debtors (300-0000)").closest("tr") as HTMLElement;
    expect(debtors.dataset.ok).toBe("false");
    expect(debtors.textContent).toMatch(/Off by 100\.00/);
    expect((screen.getByText("Trade creditors (400-0000)").closest("tr") as HTMLElement).dataset.ok).toBe("true");
    expect(screen.getByText(/310-0001 MAYBANK/)).toBeTruthy();
    openingCheck = undefined;
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });

  it("shows green when everything agrees", () => {
    settings = { ledgerStartDate: "2026-12-01", fiscalYearEndMonth: 8 };
    openingCheck = { ...CHECK, controls: CHECK.controls.map((c) => ({ ...c, documentsSen: c.controlSen })), balanced: true };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect(screen.getByTestId("opening-verdict").textContent).toMatch(/agree/);
    expect(screen.getByTestId("opening-verdict").textContent).not.toMatch(/not/);
    openingCheck = undefined;
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });
});

describe("Ledger setup — Opening balances, a moved start date", () => {
  it("says so when the opening journal is not on the opening day", () => {
    settings = { ledgerStartDate: "2027-01-01", fiscalYearEndMonth: 8 };
    openingCheck = {
      ok: true, openingDay: "2026-12-31", openingJeNo: "JE-2611-0001", openingJeDate: "2026-11-30", trialDebitSen: 0, trialCreditSen: 0,
      controls: [], banks: [], balanced: false,
    };
    render(<MemoryRouter><LedgerSetup /></MemoryRouter>);
    expect(screen.getByText(/The opening journal is dated 2026-11-30/)).toBeTruthy();
    openingCheck = undefined;
    settings = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
  });
});
