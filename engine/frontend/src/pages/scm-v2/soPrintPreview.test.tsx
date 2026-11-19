import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SoPrintPreview } from "./soPrintPreview";

function renderPreview(isUnitPriceHidden: boolean, setIsUnitPriceHidden = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SoPrintPreview
        open
        onClose={vi.fn()}
        docNo="TC-SO-3"
        rows={[]}
        layout={{ printRooms: undefined, printLayout: "area", setPrintLayout: vi.fn(), isUnitPriceHidden, setIsUnitPriceHidden }}
        onViewPdf={vi.fn()}
        onPrint={vi.fn()}
        onDownload={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return setIsUnitPriceHidden;
}

describe("SO print preview: per unit price choice", () => {
  test("offers Show and Hide even when the order has no rooms", () => {
    renderPreview(false);
    const group = screen.getByRole("group", { name: "Per unit price" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("group", { name: "Show lines" })).toBeNull();
  });

  test("pressing Hide asks to hide the unit price", () => {
    const setIsUnitPriceHidden = renderPreview(false);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(setIsUnitPriceHidden).toHaveBeenCalledWith(true);
  });

  test("shows Hide as chosen when the unit price is hidden", () => {
    renderPreview(true);
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-pressed")).toBe("true");
  });
});
