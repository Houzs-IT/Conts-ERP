import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The project on a payment voucher (finance phase 1.5; SOP 3.4): the limit left shows beside it; a voucher over it
// offers a request for the difference.
const mutateAsync = vi.fn(async () => ({ request: {} }));
vi.mock("./projectLimitQueries", () => ({
  useProjectOptions: () => ({ data: { projects: [{ id: 7, code: "RN-1", name: "SKYLINE", funding: "customer" }] } }),
  useProjectLimit: (id: number | null) => ({ data: id ? { projectId: 7, projectName: "SKYLINE", funding: "customer", pctBp: 7000, receivedSen: 1_000_000, limitSen: 700_000, usedSen: 0, reservedSen: 550_000, leftSen: 150_000 } : undefined }),
  useAskLimit: () => ({ mutateAsync, isPending: false }),
}));

import { ProjectLimitField } from "./ProjectLimitField";

describe("the project on a voucher", () => {
  it("shows what is left, and offers a request for what the voucher is over", async () => {
    render(<ProjectLimitField projectId={7} onChange={vi.fn()} amountSen={200_000} />);
    expect(screen.getByText(/Limit left RM 1,500.00 of RM 7,000.00 \(RM 5,500.00 reserved\) — this voucher is RM 500.00 over/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Request extra limit" }));
    fireEvent.change(screen.getByLabelText("Why the project needs more"), { target: { value: "Extra tiles" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for RM 500.00" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ projectId: 7, kind: "amount", amountSen: 50_000, reason: "Extra tiles" }));
  });

  it("within the limit: no request offered", () => {
    render(<ProjectLimitField projectId={7} onChange={vi.fn()} amountSen={100_000} />);
    expect(screen.queryByRole("button", { name: "Request extra limit" })).toBeNull();
  });
});
