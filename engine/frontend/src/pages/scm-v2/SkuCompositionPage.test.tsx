import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkuCompositionPage } from "./SkuCompositionPage";

const added = vi.hoisted(() => vi.fn());
const ROWS = [{ id: "r1", sku_code: "RN-PLASTER_CEILING", sku_name: "Works - Plaster ceiling", material_code: "PLC-KNK-001", material_name: "Plaster Board", uom: "PCS", qty: 2, notes: null }];

vi.mock("../../vendor/scm/lib/production-order-queries", () => ({
  useSkuCompositions: () => ({ data: ROWS, isLoading: false, error: null }),
  useCompositionSkus: () => ({ data: [{ code: "RN-PLASTER_CEILING", name: "Works - Plaster ceiling", uom: "JOB" }] }),
  useRawSkus: () => ({ data: [{ code: "PLC-KNK-001", name: "Plaster Board", uom: "PCS" }, { code: "PTN-KNK-001", name: "Gypsum", uom: "PCS" }] }),
  useAddComposition: () => ({ mutate: added, isPending: false }),
  useUpdateComposition: () => ({ mutate: vi.fn() }),
  useDeleteComposition: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../components/Layout", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));
vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("../../vendor/scm/components/SearchableSelect", () => ({
  SearchableSelect: ({ value, onChange, options, ariaLabel }: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; ariaLabel: string }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" />{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

describe("SKU Composition", () => {
  it("lists a bound SKU, opens it, and adds only a material it does not have yet", () => {
    render(<SkuCompositionPage />);
    fireEvent.click(screen.getByRole("button", { name: /RN-PLASTER_CEILING/ }));
    expect(screen.getByLabelText("Quantity of PLC-KNK-001")).toBeTruthy();
    const picker = screen.getByLabelText("Raw material") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(["", "PTN-KNK-001"]);
    fireEvent.change(picker, { target: { value: "PTN-KNK-001" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(added.mock.calls[0][0]).toEqual({ skuCode: "RN-PLASTER_CEILING", materialCode: "PTN-KNK-001", qty: 3 });
  });
});
