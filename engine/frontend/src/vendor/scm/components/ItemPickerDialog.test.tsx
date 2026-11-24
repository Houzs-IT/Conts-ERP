import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ItemPickerDialog, type ItemPickerRow } from "./ItemPickerDialog";

afterEach(cleanup);

const rows: ItemPickerRow[] = [
  { key: "1", code: "AKEMI APEX MATT (S)", name: "AKEMI APEX MATTRESS", categoryLabel: "Mattress", supplierSku: "AK-APX-S", priceLabel: "RM 900.00" },
  { key: "2", code: "AVANI 10", name: "AVANI FABRIC", categoryLabel: "Fabric" },
];

describe("ItemPickerDialog", () => {
  it("searches supplier SKU too and counts every add", () => {
    const onAdd = vi.fn();
    render(<ItemPickerDialog title="Select items" subtitle="" rows={rows} onPick={onAdd} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(/Search by item code/), { target: { value: "ak-apx" } });
    expect(screen.queryByText("AVANI 10")).toBeNull();

    const addButton = screen.getByRole("button", { name: /Add/ });
    fireEvent.click(addButton);
    fireEvent.click(screen.getByRole("button", { name: /Added/ }));

    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenLastCalledWith(rows[0]);
    expect(screen.getByText("2 items added")).toBeTruthy();
  });

  it("in replace mode marks the current item, picks one and closes", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<ItemPickerDialog title="Change item · Line 1" subtitle="" rows={rows} mode="replace" currentCode="AVANI 10" onPick={onPick} onClose={onClose} />);

    expect(screen.getByText("Current")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]);

    expect(onPick).toHaveBeenCalledWith(rows[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
