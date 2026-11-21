// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RequestMoreDialog, ReturnStockDialog } from "./renovationProductionParts";

const h = vi.hoisted(() => ({
  request: vi.fn(),
  back: vi.fn(),
  statuses: {} as Record<string, { warehouse: string | null }>,
}));

vi.mock("../../vendor/scm/lib/production-order-queries", () => ({
  useRawSkus: () => ({ data: [{ code: "DOR-KNK-003", name: "Shellac Plywood" }], isSuccess: true }),
  useRequestMore: () => ({ mutateAsync: h.request, isPending: false }),
  useReturnStock: () => ({ mutate: h.back, isPending: false }),
  useMaterialStatus: () => ({ data: h.statuses }),
}));
vi.mock("../../vendor/scm/lib/inventory-queries", () => ({
  useWarehouses: () => ({ data: [{ id: "w-blk", code: "BLK" }, { id: "w-conts", code: "CONTS-WH" }, { id: "w-site", code: "ONSITE" }] }),
}));
vi.mock("../../hooks/useToast", () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock("../../vendor/scm/components/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("../../vendor/scm/components/NotifyDialog", () => ({ useNotify: () => vi.fn() }));

afterEach(cleanup);

describe("Request more (click sweep 2, G2)", () => {
  beforeEach(() => { h.request.mockReset(); });

  it("a double press sends one request, with an idempotency key", async () => {
    let finish: (v: unknown) => void = () => {};
    h.request.mockImplementation(() => new Promise((r) => { finish = r; }));
    render(<MemoryRouter><RequestMoreDialog orderId="o1" open onClose={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("Raw material"), { target: { value: "DOR-KNK-003" } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2" } });
    const send = screen.getByRole("button", { name: "Send request" });
    fireEvent.click(send);
    fireEvent.click(send);
    await waitFor(() => expect(h.request).toHaveBeenCalledTimes(1));
    expect(h.request.mock.calls[0]![0]).toMatchObject({ itemCode: "DOR-KNK-003", qty: 2 });
    expect(typeof h.request.mock.calls[0]![0].key).toBe("string");
    finish({ ok: true, short: false });
  });
});

describe("Return stock (click sweep 2, G8)", () => {
  beforeEach(() => { h.back.mockReset(); h.statuses = {}; });
  const material = { id: "m1", item_code: "DOR-KNK-001", description: "Plywood", uom: "NOS", qty_needed: 0.5, qty_issued: 1, qty_returned: 0 } as never;

  it("goes back to the warehouse the material left from, not the first in the list", () => {
    h.statuses = { m1: { warehouse: "CONTS-WH" } };
    render(<MemoryRouter><ReturnStockDialog orderId="o1" materials={[material]} open onClose={() => {}} /></MemoryRouter>);
    expect((screen.getByLabelText("Warehouse for DOR-KNK-001") as HTMLSelectElement).value).toBe("w-conts");
    fireEvent.change(screen.getByLabelText("Return qty of DOR-KNK-001"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /Return 1/ }));
    expect(h.back.mock.calls[0]![0]).toEqual([{ materialId: "m1", qty: 1, warehouseId: "w-conts" }]);
  });
});
