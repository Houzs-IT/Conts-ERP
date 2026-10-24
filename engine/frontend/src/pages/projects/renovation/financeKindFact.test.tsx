import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The project's Type (Conts, finance phase 1.5; chew, 24 Oct 2026): renovation (301) or inhouse renovation (302), blank
// following the quotation's brand. Chosen in place before there is a contract; read-only after.
const setFinanceKind = vi.fn(async () => ({ ok: true as const }));
vi.mock("./simpleApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./simpleApi")>()),
  simpleApi: { setFinanceKind: (...a: unknown[]) => setFinanceKind(...(a as [])) },
}));

import { FinanceKindFact } from "./RenovationDetail";

describe("the project's Type", () => {
  it("blank reads as following the quotation brand, and a choice is saved", async () => {
    const onDone = vi.fn();
    render(<FinanceKindFact projectId={7} value={null} canWrite onDone={onDone} onError={vi.fn()} />);
    const select = screen.getByLabelText("Project type") as HTMLSelectElement;
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "INHOUSE_RENOVATION" } });
    await waitFor(() => expect(setFinanceKind).toHaveBeenCalledWith(7, "INHOUSE_RENOVATION"));
    expect(onDone).toHaveBeenCalledWith("Type set to Inhouse renovation (302).");
  });

  it("is read-only once there is a contract", () => {
    render(<FinanceKindFact projectId={7} value="RENOVATION" canWrite={false} onDone={vi.fn()} onError={vi.fn()} />);
    expect(screen.queryByLabelText("Project type")).toBeNull();
    expect(screen.getByText("Renovation (301)")).toBeTruthy();
  });
});
