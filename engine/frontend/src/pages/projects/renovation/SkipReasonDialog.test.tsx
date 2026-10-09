import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkipReasonDialog } from "./renovationUi";

describe("SkipReasonDialog", () => {
  it("refuses a reason shorter than 3 characters without calling the server", async () => {
    const onConfirm = vi.fn(async () => {});
    render(<SkipReasonDialog what="Appliances" onCancel={() => {}} onConfirm={onConfirm} />);
    expect(screen.getByRole("dialog", { name: "Skip Appliances" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Why is it skipped/), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at least 3 characters");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("sends the trimmed reason", async () => {
    const onConfirm = vi.fn(async () => {});
    render(<SkipReasonDialog what="Appliances" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Why is it skipped/), { target: { value: "  Customer buys his own  " } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Customer buys his own"));
  });

  it("shows the server's refusal and stays open", async () => {
    const onConfirm = vi.fn(async () => { throw new Error("This cannot be skipped."); });
    render(<SkipReasonDialog what="Design" onCancel={() => {}} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText(/Why is it skipped/), { target: { value: "no design needed" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This cannot be skipped.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
