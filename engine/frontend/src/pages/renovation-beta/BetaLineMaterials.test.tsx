import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BetaLineMaterials } from "./BetaLineMaterials";
import type { ManagedLine } from "./renovationBetaLines";

const save = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("./renovationBetaLines", () => ({
  linesApi: {
    rawMaterials: async () => ({ skus: [{ code: "PLC-KNK-001", name: "Board", uom: "PCS" }, { code: "PTN-KNK-001", name: "Gypsum", uom: "PCS" }] }),
    saveMaterials: save,
  },
  refusalText: (e: unknown) => String(e),
}));

const line = { id: "a", itemCode: "RN-PLASTER_CEILING", description: "Plaster ceiling", qty: 2, materials: [{ code: "PLC-KNK-001", name: "Board", uom: "PCS", qty: 4 }] } as unknown as ManagedLine;

describe("BetaLineMaterials", () => {
  it("shows the preset, takes a new qty and an added material, and saves the list", async () => {
    const onSaved = vi.fn();
    render(<BetaLineMaterials projectId={7} line={line} canEdit onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText("Quantity of PLC-KNK-001"), { target: { value: "5" } });
    fireEvent.click(await screen.findByLabelText("PTN-KNK-001 · Gypsum"));
    expect(screen.getByLabelText("Quantity of PTN-KNK-001")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(7, "a", [{ code: "PLC-KNK-001", qty: 5 }, { code: "PTN-KNK-001", qty: 1 }]);
  });

  it("is read-only once the line is on a PO", () => {
    render(<BetaLineMaterials projectId={7} line={line} canEdit={false} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText("Quantity of PLC-KNK-001")).toBeNull();
    expect(screen.getByText("Change these on the production order.")).toBeTruthy();
  });
});
