// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductionMaterialsSection } from "./ProductionMaterialsSection";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  add: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  success: vi.fn(),
}));

vi.mock("../../vendor/scm/lib/production-order-queries", () => ({
  useProductionMaterials: () => ({ data: h.rows, isLoading: false, error: null, isSuccess: true }),
  useMaterialStatus: () => ({ data: {} }),
  useRawSkus: () => ({ data: [{ code: "RAW-1", name: "Plywood" }], isSuccess: true }),
  useAddProductionMaterial: () => ({ mutate: h.add, isPending: false }),
  useUpdateProductionMaterial: () => ({ mutate: h.update, isPending: false }),
  useDeleteProductionMaterial: () => ({ mutate: vi.fn() }),
}));
vi.mock("@tanstack/react-query", async (o) => ({ ...(await o<typeof import("@tanstack/react-query")>()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("../../vendor/scm/lib/mfg-products-queries", () => ({ useCreateMfgProduct: () => ({ mutate: h.create, isPending: false }) }));
vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ success: h.success }) }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));

const pick = async () => {
  fireEvent.focus(screen.getByLabelText("Raw material"));
  fireEvent.mouseDown(await screen.findByText("RAW-1 · Plywood"));
};
const show = () => render(<MemoryRouter><ProductionMaterialsSection orderId="o1" canEdit /></MemoryRouter>);

describe("adding a raw material", () => {
  beforeEach(() => {
    h.rows = [];
    h.add.mockReset().mockImplementation((_b, o: { onSuccess: () => void }) => o.onSuccess());
    h.update.mockReset().mockImplementation((_b, o: { onSuccess: () => void }) => o.onSuccess());
    h.success.mockReset();
  });
  afterEach(cleanup);

  it("says so and empties the picker, which used to keep the name as if nothing happened", async () => {
    show();
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Plywood added"));
    expect((screen.getByLabelText("Raw material") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("creates a new material from the form and picks it", async () => {
    h.create.mockReset().mockImplementation((_b, o: { onSuccess: (r: { code: string }) => void }) => o.onSuccess({ code: "NEW-1" }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Create a new raw material" }));
    fireEvent.change(screen.getByLabelText("New SKU code"), { target: { value: "new-1" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Glue" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(h.create.mock.calls[0]![0]).toMatchObject({ code: "NEW-1", name: "Glue", category: "RAW", subCategory: "OTHER_RAW", uom: "PCS" });
    expect(h.success).toHaveBeenCalledWith("NEW-1 created");
  });

  it("opens with the form only when the order has no materials", () => {
    h.rows = [{ id: "m1", item_code: "RAW-1", description: "Plywood", uom: "PCS", qty_needed: 2, processing_date: null, delivery_date: "2026-12-01", notes: null }];
    show();
    expect(screen.queryByLabelText("Raw material")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Raw material" }));
    expect(screen.getByLabelText("Raw material")).toBeTruthy();
  });

  it("adds to the line when the material and dates match", async () => {
    h.rows = [{ id: "m1", item_code: "RAW-1", description: "Plywood", uom: "PCS", qty_needed: 2, processing_date: null, delivery_date: null }];
    show();
    fireEvent.click(screen.getByRole("button", { name: "Raw material" }));
    await pick();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0]![0]).toEqual({ id: "m1", qtyNeeded: 3 });
    expect(h.add).not.toHaveBeenCalled();
  });

  it("says why a line with no delivery date is missing from MRP", () => {
    h.rows = [{ id: "m1", item_code: "RAW-1", description: "Plywood", uom: "PCS", qty_needed: 2, processing_date: null, delivery_date: null }];
    show();
    expect(screen.getByText("Add a delivery date to show it in MRP")).toBeTruthy();
  });
});
