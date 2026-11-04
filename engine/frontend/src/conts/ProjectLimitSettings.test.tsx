import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Ledger setup → Project limit (SOP 3.4; chew 4 Nov 2026): finance switches the check off while customer payments
// are not all in, and keeps the share every customer project without its own uses. Saving asks first.
const saveAsync = vi.fn(async (b: unknown) => b);
const confirmFn = vi.fn(async (_: { title: string; body: string }) => true);
/* One object, as React Query keeps it: the form re-opens on what is saved only when that changes. */
const saved = { checked: true, pctBp: 7000 };
vi.mock("./projectLimitQueries", () => ({
  useLimitSettings: () => ({ data: saved, isSuccess: true, isError: false }),
  useSaveLimitSettings: () => ({ mutateAsync: saveAsync, isPending: false }),
}));
vi.mock("../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => confirmFn }));

import { ProjectLimitSettings } from "./ProjectLimitSettings";

describe("the project limit settings", () => {
  beforeEach(() => { saveAsync.mockClear(); confirmFn.mockClear(); confirmFn.mockResolvedValue(true); });

  it("opens on what is saved", () => {
    render(<ProjectLimitSettings canSave />);
    expect((screen.getByLabelText("Check project limits") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Default limit %") as HTMLInputElement).value).toBe("70");
  });

  it("switches the check off and sets 80%, after saying what changes", async () => {
    render(<ProjectLimitSettings canSave />);
    fireEvent.click(screen.getByLabelText("Check project limits"));
    fireEvent.change(screen.getByLabelText("Default limit %"), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveAsync).toHaveBeenCalledWith({ checked: false, pctBp: 8000 }));
    expect(confirmFn.mock.calls[0]![0].title).toBe("Switch the project limit check off, and change the default limit from 70% to 80%?");
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("cancelled, nothing is saved; a share over 100% is refused", async () => {
    confirmFn.mockResolvedValue(false);
    render(<ProjectLimitSettings canSave />);
    fireEvent.change(screen.getByLabelText("Default limit %"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    expect(saveAsync).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Default limit %"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The default limit is between 0% and 100%.")).toBeTruthy();
    expect(saveAsync).not.toHaveBeenCalled();
  });

  it("without the key it can be read, not changed", () => {
    render(<ProjectLimitSettings canSave={false} />);
    expect((screen.getByLabelText("Check project limits") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only someone who approves extra project limit may change these.")).toBeTruthy();
  });
});
