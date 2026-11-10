// Project workspace > Overview > Client & team — the brand and its finance type (chew, 10 Nov 2026: "去那里选品牌？"
// — the brand could only be set on the older project page). What is pinned:
//   • the card shows the project's brand and finance type, and the brand is chosen in place (its SO follows);
//   • the finance type is read-only once there is a contract, and hidden from those who do not see the money;
//   • without the write right both read as text.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BetaTabProps } from "./betaShared";

const setBrand = vi.fn(async () => ({ ok: true as const }));
vi.mock("../projects/renovation/simpleApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../projects/renovation/simpleApi")>()),
  simpleApi: { setBrand: (...a: unknown[]) => setBrand(...(a as [])), setFinanceKind: vi.fn() },
}));
vi.mock("../../lib/renovation/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/renovation/api")>()),
  useBrands: () => ({ data: { brands: [
    { brandId: 1, name: "Dream Crafter", active: true, hasProfile: true },
    { brandId: 2, name: "The Conts", active: true, hasProfile: true },
  ] } }),
}));

import { TeamCard } from "./BetaOverviewTab";

function props(over: { brand?: string | null; financeKind?: string | null; so?: boolean; financeHidden?: boolean; canWrite?: boolean } = {}) {
  const onDone = vi.fn();
  const p = {
    projectId: 313,
    canWrite: over.canWrite ?? true,
    onDone,
    onError: vi.fn(),
    board: { p: { lead: { name: "Wong" }, site: null } },
    detail: {
      project: { id: 313, customer_name: "Tan", customer_phone: "012-3456789", brand: over.brand ?? null, finance_kind: over.financeKind ?? null },
      people: { attending: [], sales: { name: "Nico" } },
      financeHidden: over.financeHidden ?? false,
      so: over.so ? { doc_no: "TC-SO-2611-028", status: "CONFIRMED", so_date: null, agent: null } : null,
    },
  } as unknown as BetaTabProps;
  return { p, onDone };
}
const card = () => within(screen.getByRole("region", { name: "Client & team" }));

beforeEach(() => setBrand.mockClear());

describe("Client & team — brand and finance type", () => {
  test("a project with no brand offers the brands, and the chosen one is saved", async () => {
    const { p, onDone } = props();
    render(<TeamCard p={p} onEdit={() => {}} />);
    const brand = card().getByLabelText("Brand") as HTMLSelectElement;
    expect(Array.from(brand.options).map((o) => o.textContent)).toEqual(["Choose a brand", "Dream Crafter", "The Conts"]);
    fireEvent.change(brand, { target: { value: "2" } });
    await waitFor(() => expect(setBrand).toHaveBeenCalledWith(313, 2));
    expect(onDone).toHaveBeenCalledWith("Brand set to The Conts. Its sales order follows.");
  });

  test("the saved brand and finance type show; the finance type is chosen in place before a contract", () => {
    const { p } = props({ brand: "The Conts", financeKind: "INHOUSE_RENOVATION" });
    render(<TeamCard p={p} onEdit={() => {}} />);
    expect((card().getByLabelText("Brand") as HTMLSelectElement).value).toBe("2");
    expect((card().getByLabelText("Project type") as HTMLSelectElement).value).toBe("INHOUSE_RENOVATION");
  });

  test("once there is a contract the finance type reads as text", () => {
    const { p } = props({ brand: "The Conts", financeKind: "INHOUSE_RENOVATION", so: true });
    render(<TeamCard p={p} onEdit={() => {}} />);
    expect(card().queryByLabelText("Project type")).toBeNull();
    expect(card().getByText("Inhouse renovation (302)")).toBeTruthy();
    expect(card().getByLabelText("Brand")).toBeTruthy();
  });

  test("hidden from those who do not see the money; without the write right both read as text", () => {
    const hidden = props({ brand: "Dream Crafter", financeHidden: true });
    const { unmount } = render(<TeamCard p={hidden.p} onEdit={() => {}} />);
    expect(card().queryByText("Finance type")).toBeNull();
    unmount();
    const reader = props({ brand: "Dream Crafter", financeKind: "RENOVATION", canWrite: false });
    render(<TeamCard p={reader.p} onEdit={() => {}} />);
    expect(card().queryByLabelText("Brand")).toBeNull();
    expect(card().getByText("Dream Crafter")).toBeTruthy();
    expect(card().getByText("Renovation (301)")).toBeTruthy();
  });
});
