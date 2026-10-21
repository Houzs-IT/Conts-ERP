import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The Ledger setup page (finance phase 1, spec 3.7 and 3.8): the day the books start and the fiscal year end.
const saveAsync = vi.fn(async (p: unknown) => p);
let settings: { ledgerStartDate: string | null; fiscalYearEndMonth: number } | undefined = { ledgerStartDate: null, fiscalYearEndMonth: 8 };
vi.mock("./ledgerSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledgerSettings")>()),
  useLedgerSettings: () => ({ data: settings, isLoading: false, isError: false }),
  useSaveLedgerSettings: () => ({ mutateAsync: saveAsync, isPending: false }),
}));

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
});
