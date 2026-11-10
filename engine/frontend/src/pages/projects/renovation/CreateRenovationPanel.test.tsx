// New renovation project — the brand (chew, 10 Nov 2026: "create new project 时没有办法选是 The Conts 还是 Dream
// Crafter"). What is pinned:
//   • a customer project must name its brand before it can be created, and the brand goes with it (by id);
//   • an internal Renovation project names its brand the same way;
//   • an internal Rental project has none.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const create = vi.fn(async (_b: Record<string, unknown>) => ({ id: 77, code: "RN-2611-003" }));

vi.mock("../../../hooks/useQuery", () => ({
  useQuery: (key: unknown[]) => (key[1] === "types"
    ? { data: { data: [{ id: 4, name: "Full renovation", active: true }] }, loading: false, error: null }
    : { data: { ready: false }, loading: false, error: null }),
}));
vi.mock("./renovationApi", () => ({ renovationApi: { types: vi.fn(), create: (b: Record<string, unknown>) => create(b) } }));
vi.mock("./customerPropertyApi", () => ({ projectInfoApi: { lists: vi.fn() } }));
vi.mock("./PersonSelect", () => ({ PersonSelect: () => null, usePeople: () => ({ data: { data: [] } }) }));
vi.mock("./ProjectRecords", () => ({ AttendingPicker: () => null }));
/* The customer block's one field this test needs: the customer's name. */
vi.mock("./CustomerBlock", () => ({
  CustomerBlock: ({ value, onChange }: { value: { customerName: string }; onChange: (v: unknown) => void }) => (
    <input aria-label="Customer name" value={value.customerName} onChange={(e) => onChange({ ...value, customerName: e.target.value })} />
  ),
}));
vi.mock("../../../lib/renovation/api", () => ({
  useBrands: () => ({ data: { brands: [
    { brandId: 1, name: "Dream Crafter", active: true, hasProfile: true },
    { brandId: 2, name: "The Conts", active: true, hasProfile: true },
    { brandId: 3, name: "Old brand", active: false, hasProfile: false },
  ] } }),
}));

import { CreateRenovationPanel } from "./CreateRenovationPanel";

const open = () => render(<CreateRenovationPanel onClose={() => {}} onCreated={() => {}} />);
const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => create.mockClear());

describe("New renovation project — the brand", () => {
  test("a customer project cannot be created until its brand is chosen", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Tan Mei Ling" } });
    fireEvent.click(screen.getByText("Create project"));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose the brand: Dream Crafter or The Conts.");
    expect(create).not.toHaveBeenCalled();
  });

  test("the brand list offers the brands in use, and the chosen one goes with the new project", async () => {
    open();
    const options = Array.from((screen.getByLabelText("Brand") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["— Choose —", "Dream Crafter", "The Conts"]);
    fireEvent.change(screen.getByLabelText("Customer name"), { target: { value: "Tan Mei Ling" } });
    pick("Brand", "2");
    fireEvent.click(screen.getByText("Create project"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ brandId: 2, customerName: "Tan Mei Ling", projectTypeId: 4 });
    expect(create.mock.calls[0][0]).not.toHaveProperty("financeKind");
  });

  test("an internal Renovation project names its brand the same way", async () => {
    open();
    pick("Funding", "internal");
    pick("Counts to", "supply");
    pick("Budget (RM)", "5000");
    fireEvent.click(screen.getByText("Create project"));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose the brand: Dream Crafter or The Conts.");
    pick("Brand", "1");
    fireEvent.click(screen.getByText("Create project"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ funding: "internal", internalDepartment: "supply", budgetSen: 500000, brandId: 1 });
  });

  test("an internal Rental project has no brand", async () => {
    open();
    pick("Funding", "internal");
    pick("Counts to", "rental");
    expect(screen.queryByLabelText("Brand")).toBeNull();
    pick("Budget (RM)", "1200");
    fireEvent.click(screen.getByText("Create project"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ funding: "internal", internalDepartment: "rental" });
    expect(create.mock.calls[0][0]).not.toHaveProperty("brandId");
  });
});
