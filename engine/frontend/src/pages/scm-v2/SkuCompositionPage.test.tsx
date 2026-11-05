import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkuCompositionPage } from "./SkuCompositionPage";

const added = vi.hoisted(() => vi.fn());
const ROWS = [
  { id: "r1", sku_code: "RN-PLASTER_CEILING", sku_name: "Works - Plaster ceiling", material_code: "PLC-KNK-001", material_name: "Plaster Board", uom: "PCS", qty: 2, notes: null },
  { id: "r2", sku_code: "RN-FEATURE_WALL", sku_name: "Works - Feature wall", material_code: "PTN-KNK-002", material_name: "Primer", uom: "PCS", qty: 4, notes: null },
];

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../../vendor/scm/lib/mfg-products-queries", () => ({ useCreateMfgProduct: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../../vendor/scm/lib/production-order-queries", () => ({
  useSkuCompositions: () => ({ data: ROWS, isLoading: false, error: null }),
  useCompositionSkus: () => ({ data: [{ code: "RN-PLASTER_CEILING", name: "Works - Plaster ceiling", uom: "JOB" }, { code: "RN-PAINTING", name: "Works - Painting", uom: "JOB" }] }),
  useRawSkus: () => ({ data: [{ code: "PLC-KNK-001", name: "Plaster Board", uom: "PCS" }, { code: "PTN-KNK-001", name: "Gypsum", uom: "PCS" }, { code: "PTN-KNK-002", name: "Primer", uom: "PCS" }] }),
  useAddComposition: () => ({ mutateAsync: added, isPending: false }),
  useUpdateComposition: () => ({ mutate: vi.fn() }),
  useDeleteComposition: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../components/Layout", () => ({
  PageHeader: ({ title, primaryAction }: { title: string; primaryAction?: React.ReactNode }) => <div><h1>{title}</h1>{primaryAction}</div>,
}));
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
  it("opens a bound SKU and offers only the materials it does not have yet", () => {
    render(<SkuCompositionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit RN-PLASTER_CEILING" }));
    expect(screen.getByLabelText("Quantity of PLC-KNK-001")).toBeTruthy();
    expect(screen.queryByLabelText("PLC-KNK-001 · Plaster Board")).toBeNull();
    expect(screen.getByLabelText("PTN-KNK-001 · Gypsum")).toBeTruthy();
  });

  it("lists every SKU's composition", () => {
    render(<SkuCompositionPage />);
    expect(screen.getByText("SKUs with a composition (2)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete RN-FEATURE_WALL" })).toBeTruthy();
  });

  it("copies another SKU's materials with their quantities, before saving", () => {
    added.mockClear();
    render(<SkuCompositionPage />);
    fireEvent.click(screen.getByRole("button", { name: "Edit RN-PLASTER_CEILING" }));
    fireEvent.change(screen.getByLabelText("Copy from another SKU"), { target: { value: "RN-FEATURE_WALL" } });
    expect((screen.getByLabelText("New quantity of PTN-KNK-002") as HTMLInputElement).value).toBe("4");
    expect(added).not.toHaveBeenCalled();
  });

  it("makes a new composition with several materials at once", async () => {
    added.mockClear();
    render(<SkuCompositionPage />);
    fireEvent.click(screen.getByRole("button", { name: "New composition" }));
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "RN-PAINTING" } });
    fireEvent.click(screen.getByLabelText("PTN-KNK-001 · Gypsum"));
    fireEvent.click(screen.getByLabelText("PTN-KNK-002 · Primer"));
    fireEvent.change(screen.getByLabelText("New quantity of PTN-KNK-002"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 2 raw materials" }));
    await waitFor(() => expect(added).toHaveBeenCalledTimes(2));
    expect(added.mock.calls[1][0]).toEqual({ skuCode: "RN-PAINTING", materialCode: "PTN-KNK-002", qty: 3 });
  });
});
