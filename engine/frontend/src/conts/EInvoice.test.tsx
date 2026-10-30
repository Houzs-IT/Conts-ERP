import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// E-invoice page (plan 2026-10-30-renovation-einvoice-ready.md Task 7). Pinned: counts and rows show; saving sends the
// form; SST cannot be switched on; the template preview renders chew's example; a not-ready row says what is missing.
const saveAsync = vi.fn();
const refreshMutate = vi.fn();
const SETTINGS = {
  active: false, classificationCode: "022", taxType: "06", sstEnabled: false, sstMode: null, sstOutputAccount: null,
  renoDescriptionTemplate: "{ordinal} Progress Billing for Interior Design & Renovation Works ({pct} {label} as per Sales Order, refer to attached breakdown)",
  seller: { tin: "", brn: "", sstNo: "", msicCode: "", activityDesc: "", address1: "", address2: "", city: "", postcode: "", stateCode: "", phone: "", email: "" },
  sellerMissing: ["seller TIN"], taxTypes: { "06": "Not applicable", E: "Tax exemption" },
};
vi.mock("./einvoiceQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./einvoiceQueries")>()),
  useEInvoiceSettings: () => ({ data: SETTINGS, isLoading: false }),
  useSaveEInvoiceSettings: () => ({ mutateAsync: saveAsync, isPending: false }),
  useRefreshOutbox: () => ({ mutate: refreshMutate, isPending: false }),
  useOutbox: () => ({ isLoading: false, isError: false, data: {
    counts: { READY: 3, NOT_READY: 1, CANCELLED: 2, SUBMITTED: 0, VALID: 0, REJECTED: 0 },
    rows: [{ id: "o1", docKind: "INVOICE", docNumber: "2990SI-2611-001", debtorCode: "301-M002", debtorName: "MS LEE", date: "2026-11-03",
      amountSen: 1_500_000, status: "NOT_READY", missing: ["buyer ID number", "buyer state"] }],
  } }),
  useOutboxRow: () => ({ isLoading: false, data: null }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("../components/Layout", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../components/DataTable", () => ({
  DataTable: ({ rows, columns }: { rows: Array<Record<string, unknown>> | null; columns: Array<{ key: string; render: (r: unknown) => React.ReactNode }> }) => (
    <table><tbody>{(rows ?? []).map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}</tr>)}</tbody></table>
  ),
}));

import { EInvoice } from "./EInvoice";

const page = () => render(<MemoryRouter><EInvoice /></MemoryRouter>);

describe("E-invoice page", () => {
  it("shows counts and outbox rows", () => {
    page();
    expect(screen.getByTestId("count-READY").textContent).toBe("3");
    expect(screen.getByTestId("count-NOT_READY").textContent).toBe("1");
    expect(screen.getByText("2990SI-2611-001")).toBeTruthy();
    expect(screen.getByText("Off — nothing is sent.")).toBeTruthy();
  });

  it("not-ready row shows what is missing, with a way to the customer account", () => {
    page();
    expect(screen.getByText(/buyer ID number, buyer state/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Customer account" }).getAttribute("href")).toBe("/scm/debtors");
  });

  it("saving settings sends the form", async () => {
    saveAsync.mockReset();
    saveAsync.mockResolvedValue(SETTINGS);
    page();
    fireEvent.change(screen.getByLabelText("Seller TIN"), { target: { value: "C12345678901" } });
    fireEvent.change(screen.getByLabelText("MSIC code"), { target: { value: "43301" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledTimes(1));
    const body = saveAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ classificationCode: "022", taxType: "06", sstEnabled: false, seller: { tin: "C12345678901", msicCode: "43301" } });
    expect("sellerMissing" in body).toBe(false);
  });

  it("a refusal is shown in the server's words", async () => {
    saveAsync.mockReset();
    saveAsync.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 400, body: JSON.stringify({ error: "invalid_setting", field: "active", message: "Fill in the seller details first: seller TIN." }) }));
    page();
    fireEvent.click(screen.getByLabelText(/E-invoice active/));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Fill in the seller details first: seller TIN.");
  });

  it("SST switch is disabled", () => {
    page();
    expect((screen.getByLabelText("SST") as HTMLInputElement).disabled).toBe(true);
  });

  it("template preview renders chew's example", () => {
    page();
    expect(screen.getByTestId("template-preview").textContent)
      .toBe("1st Progress Billing for Interior Design & Renovation Works (15% Deposit & Design Fee as per Sales Order, refer to attached breakdown)");
  });

  it("re-check all asks the server and says what is left", async () => {
    refreshMutate.mockReset();
    refreshMutate.mockImplementation((_: unknown, o: { onSuccess: (r: unknown) => void }) => o.onSuccess({ refreshed: 50, remaining: 12 }));
    page();
    fireEvent.click(screen.getByRole("button", { name: "Re-check all" }));
    expect(refreshMutate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("50 checked, 12 still to go: press Re-check all again.")).toBeTruthy();
  });

  it("after saving, the form shows what the server kept", async () => {
    saveAsync.mockReset();
    saveAsync.mockResolvedValue({ ...SETTINGS, seller: { ...SETTINGS.seller, tin: "C12345678901" }, recheckRemaining: 0 });
    page();
    fireEvent.change(screen.getByLabelText("Seller TIN"), { target: { value: "c12345678901" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect((screen.getByLabelText("Seller TIN") as HTMLInputElement).value).toBe("C12345678901"));
  });
});
