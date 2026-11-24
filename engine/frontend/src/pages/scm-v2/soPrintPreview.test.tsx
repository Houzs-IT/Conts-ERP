import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SoPrintPreview } from "./soPrintPreview";
import type { UnitPriceChoice } from "../../vendor/scm/lib/sales-order-pdf";

function renderPreview(unitPrice: UnitPriceChoice, setUnitPrice = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SoPrintPreview
        open
        onClose={vi.fn()}
        docNo="TC-SO-3"
        rows={[]}
        layout={{ printRooms: undefined, printLayout: "area", setPrintLayout: vi.fn(), unitPrice, setUnitPrice }}
        onViewPdf={vi.fn()}
        onPrint={vi.fn()}
        onDownload={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return setUnitPrice;
}

describe("SO print preview: per unit price choice", () => {
  test("offers Show, Hide and Total even when the order has no rooms", () => {
    renderPreview("show");
    const group = screen.getByRole("group", { name: "Per unit price" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Total" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Show lines" })).toBeNull();
  });

  test("pressing Hide asks to hide the unit price", () => {
    const setUnitPrice = renderPreview("show");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(setUnitPrice).toHaveBeenCalledWith("hide");
  });

  test("pressing Total asks for qty and subtotal only", () => {
    const setUnitPrice = renderPreview("show");
    fireEvent.click(screen.getByRole("button", { name: "Total" }));
    expect(setUnitPrice).toHaveBeenCalledWith("total");
  });

  test("shows Hide as chosen when the unit price is hidden", () => {
    renderPreview("hide");
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-pressed")).toBe("true");
  });
});
