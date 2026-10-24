import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// A supplier's control on its page (finance phase 1.5): read-only without the post key; with it, a change asks first,
// is sent alone, and a refusal (still owing) is shown in the server's words.
let canPost = true;
const mutateAsync = vi.fn();
const confirmFn = vi.fn(async () => true);
let perms = ["scm.ledger.use", "scm.payment_voucher.post"];
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ can: () => canPost, user: { permissions: perms } }) }));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));
vi.mock("../vendor/scm/lib/accounting-queries", () => ({
  useAccounts: () => ({ isLoading: false, data: { accounts: [
    { account_code: "400-0000", account_name: "TRADE CREDITORS", special_type: "SCC", is_active: true },
    { account_code: "405-0000", account_name: "OTHER CREDITORS", special_type: "SCC", is_active: true },
    { account_code: "900-A001", account_name: "RENT", special_type: null, is_active: true },
  ] } }),
}));
vi.mock("../vendor/scm/lib/suppliers-queries", () => ({ useUpdateSupplier: () => ({ mutateAsync, isPending: false }) }));

import { SupplierControl } from "./SupplierControl";

const S = { id: "s1", code: "400-H010", control_account: "400-0000" };

describe("a supplier's control on its page", () => {
  it("without the post key it is shown, not offered", () => {
    canPost = false;
    render(<SupplierControl supplier={S} />);
    expect(screen.queryByLabelText("Supplier control")).toBeNull();
    expect(screen.getByText("400-0000")).toBeTruthy();
    canPost = true;
  });

  it("the * wildcard without the Ledger is shown, not offered", () => {
    perms = ["*"];
    render(<SupplierControl supplier={S} />);
    expect(screen.queryByLabelText("Supplier control")).toBeNull();
    perms = ["scm.ledger.use", "scm.payment_voucher.post"];
  });

  it("offers only supplier controls; a move asks first and a refusal is shown", async () => {
    mutateAsync.mockReset();
    mutateAsync.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 409, body: JSON.stringify({ error: "supplier_has_balance", message: "400-H010 still has a balance on 400-0000." }) }));
    render(<SupplierControl supplier={S} />);
    const select = screen.getByLabelText("Supplier control") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["400-0000", "405-0000"]);
    fireEvent.change(select, { target: { value: "405-0000" } });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: "s1", controlAccount: "405-0000" }));
    expect(confirmFn).toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toBe("400-H010 still has a balance on 400-0000.");
  });
});
