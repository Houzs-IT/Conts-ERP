/* The PO tab's variant pickers are the SO line's: options from the master Maintenance lists, narrowed by the SKU
   Model's allowed options; a bedframe height pick moves the total height in the same patch. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("../lib/mfg-products-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mfg-products-queries")>();
  return {
    ...actual,
    useMaintenanceConfig: () => ({
      data: {
        data: {
          gaps: ['4"', '6"'],
          divanHeights: [{ value: '4"', priceSen: 0 }, { value: '6"', priceSen: 0 }, { value: '8"', priceSen: 0 }, { value: '10"', priceSen: 0, active: false }],
          legHeights: [{ value: '1"', priceSen: 0 }, { value: '2"', priceSen: 0 }],
          sofaSizes: ["24", "28"],
          sofaLegHeights: [{ value: "Default", priceSen: 0 }, { value: '4"', priceSen: 0 }],
        },
      },
    }),
    // The Model allows only 4" and 6" divans.
    useModelAllowedOptionsByCode: () => ({ data: { divan_heights: ['4"', '6"'] } }),
  };
});
vi.mock("../lib/queries", () => ({ useFabricLibrary: () => ({ data: [] }) }));
vi.mock("../lib/fabric-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/fabric-queries")>();
  return { ...actual, useFabricColoursSearch: () => ({ data: [], isFetching: false }) };
});

import { RenovationVariantPicker, hasVariantPickers } from "./renovationVariantPicker";

describe("RenovationVariantPicker", () => {
  it("a bedframe offers the master divans the Model allows, and a pick carries the new total height", () => {
    const onPatch = vi.fn();
    render(<RenovationVariantPicker category="BEDFRAME" itemCode="BED-1" variants={{ fabricCode: "PC1461-01", divanHeight: '4"', legHeight: '1"', gap: '4"', totalHeight: '9"' }} onPatch={onPatch} />);
    const divan = screen.getByLabelText("Divan Heights") as HTMLSelectElement;
    expect(within(divan).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select…", '4"', '6"']);
    expect(screen.getByLabelText("Fabrics")).toHaveProperty("value", "PC1461-01");
    fireEvent.change(divan, { target: { value: '6"' } });
    expect(onPatch).toHaveBeenCalledWith({ divanHeight: '6"', totalHeight: '11"' });
  });
  it("a sofa has fabric, seat size and leg; other categories have no pickers", () => {
    render(<RenovationVariantPicker category="SOFA" itemCode="SOF-1" variants={{ seatHeight: "24", legHeight: "Default" }} onPatch={vi.fn()} />);
    expect(within(screen.getByLabelText("Seat Size")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Select…", "24", "28"]);
    expect(screen.getByLabelText("Leg Heights")).toBeTruthy();
    expect(screen.queryByLabelText("Divan Heights")).toBeNull();
    expect(hasVariantPickers("SOFA")).toBe(true);
    expect(hasVariantPickers("WORKS")).toBe(false);
    expect(hasVariantPickers(null)).toBe(false);
  });
});
