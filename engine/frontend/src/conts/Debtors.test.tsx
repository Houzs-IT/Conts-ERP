import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Debtors (finance phase 1.5, SOP 2.1): every customer under its control. Pinned: a new debtor goes in with its
// control and a blank code (the server numbers it); a move to another control asks first, and a refusal is shown
// in the server's words.
const saveAsync = vi.fn();
const confirmFn = vi.fn(async () => true);
vi.mock("./debtorQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./debtorQueries")>()),
  useDebtors: () => ({ isLoading: false, isError: false, data: { controls: [
    { code: "301-0000", name: "RENOVATION CUSTOMER", debtors: [
      { id: "d1", code: "301-M001", name: "MS LEE", control_account: "301-0000", customer_id: null, phone: "012", email: null, address: null, notes: null, is_active: true,
        tin: null, id_type: null, id_number: null, sst_no: null },
    ] },
    { code: "302-0000", name: "INHOUSE RENOVATION CUSTOMER", debtors: [] },
  ] } }),
  useSaveDebtor: () => ({ mutateAsync: saveAsync, isPending: false }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));
vi.mock("../components/Layout", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("../components/DataTable", () => ({
  DataTable: ({ rows, onRowClick }: { rows: Array<{ id: string; code: string; name: string; controlLabel: string }> | null; onRowClick?: (r: unknown) => void }) => (
    <ul>{(rows ?? []).map((r) => <li key={r.id}><button onClick={() => onRowClick?.(r)}>{r.controlLabel} · {r.code} {r.name}</button></li>)}</ul>
  ),
}));

import { Debtors } from "./Debtors";

describe("Debtors", () => {
  it("lists each debtor with its control", () => {
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    expect(screen.getByText("301-0000 RENOVATION CUSTOMER · 301-M001 MS LEE")).toBeTruthy();
  });

  it("a new debtor goes in with its control and a blank code", async () => {
    saveAsync.mockReset();
    saveAsync.mockResolvedValue({ debtor: {} });
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /New debtor/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MS CHEW" } });
    fireEvent.change(screen.getByLabelText("Control"), { target: { value: "302-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledTimes(1));
    expect(saveAsync.mock.calls[0][0]).toMatchObject({ id: null, body: { name: "MS CHEW", controlAccount: "302-0000", code: "" } });
  });

  it("a move asks first, and a refusal (still owing) is shown in the server's words", async () => {
    saveAsync.mockReset();
    confirmFn.mockClear();
    const refused = Object.assign(new Error("refused"), { status: 409, body: JSON.stringify({ error: "debtor_has_balance", message: "301-M001 still has a balance on 301-0000." }) });
    saveAsync.mockRejectedValueOnce(refused);
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    fireEvent.click(screen.getByText(/301-M001 MS LEE/));
    fireEvent.change(screen.getByLabelText("Control"), { target: { value: "302-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "301-M001 still has a balance on 301-0000.");
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(saveAsync).toHaveBeenCalledTimes(1);
    expect(saveAsync.mock.calls[0][0]).toMatchObject({ id: "d1", body: { controlAccount: "302-0000" } });
  });

  it("a declined move sends nothing", async () => {
    saveAsync.mockReset();
    confirmFn.mockResolvedValueOnce(false);
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    fireEvent.click(screen.getByText(/301-M001 MS LEE/));
    fireEvent.change(screen.getByLabelText("Control"), { target: { value: "302-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    expect(saveAsync).not.toHaveBeenCalled();
  });

  it("edit form shows the e-invoice fields and saves them", async () => {
    saveAsync.mockReset();
    saveAsync.mockResolvedValue({ debtor: {} });
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    fireEvent.click(screen.getByText(/301-M001 MS LEE/));
    fireEvent.change(screen.getByLabelText("Tax ID (TIN)"), { target: { value: "IG12345678901" } });
    fireEvent.change(screen.getByLabelText("ID type"), { target: { value: "NRIC" } });
    fireEvent.change(screen.getByLabelText("ID number"), { target: { value: "900101-14-5678" } });
    fireEvent.change(screen.getByLabelText("SST registration no."), { target: { value: "W10-1808-31000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledTimes(1));
    expect(saveAsync.mock.calls[0][0]).toMatchObject({ id: "d1", body: { tin: "IG12345678901", idType: "NRIC", idNumber: "900101-14-5678", sstNo: "W10-1808-31000001" } });
  });
});

describe("Debtors: only changed tax fields are sent", () => {
  it("a rename sends no tax fields", async () => {
    saveAsync.mockReset();
    saveAsync.mockResolvedValue({ debtor: {} });
    render(<MemoryRouter><Debtors /></MemoryRouter>);
    fireEvent.click(screen.getByText(/301-M001 MS LEE/));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MS LEE AH" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledTimes(1));
    const body = saveAsync.mock.calls[0][0].body as Record<string, unknown>;
    expect(["tin", "idType", "idNumber", "sstNo"].filter((k) => k in body)).toEqual([]);
  });
});
