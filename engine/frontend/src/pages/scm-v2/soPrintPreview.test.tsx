import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SoPrintPreview } from "./soPrintPreview";
import { ALL_SO_PDF_COLUMNS, type SoPdfColumns } from "../../vendor/scm/lib/sales-order-pdf";

function renderPreview(columns: SoPdfColumns, setColumns = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SoPrintPreview
        open
        onClose={vi.fn()}
        docNo="TC-SO-3"
        rows={[]}
        layout={{ printRooms: undefined, printLayout: "area", setPrintLayout: vi.fn(), columns, setColumns }}
        onViewPdf={vi.fn()}
        onPrint={vi.fn()}
        onDownload={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return setColumns;
}

describe("SO print preview: column ticks", () => {
  test("offers Qty, Unit, Price, Discount and Amount, all ticked, even when the order has no rooms", () => {
    renderPreview(ALL_SO_PDF_COLUMNS);
    expect(screen.getByRole("group", { name: "Columns" })).toBeTruthy();
    for (const name of ["Qty", "Unit", "Price", "Discount", "Amount"]) {
      expect((screen.getByRole("checkbox", { name }) as HTMLInputElement).checked).toBe(true);
    }
    expect(screen.queryByRole("group", { name: "Show lines" })).toBeNull();
  });

  test("unticking Amount asks for every other column with Amount off", () => {
    const setColumns = renderPreview(ALL_SO_PDF_COLUMNS);
    fireEvent.click(screen.getByRole("checkbox", { name: "Amount" }));
    expect(setColumns).toHaveBeenCalledWith({ ...ALL_SO_PDF_COLUMNS, amount: false });
  });

  test("shows Price unticked when the price is hidden", () => {
    renderPreview({ ...ALL_SO_PDF_COLUMNS, price: false });
    expect((screen.getByRole("checkbox", { name: "Price" }) as HTMLInputElement).checked).toBe(false);
  });
});
