import { describe, expect, it } from "vitest";
import { soColumns, type ProjectSo } from "./renovationBetaSoColumns";

type Row = { so: ProjectSo | undefined; brand: string | null };
const branding = soColumns<Row>((row) => row.so, (row) => ({ brand: row.brand })).find((c) => c.key === "so_branding");
const brandingOf = (row: Row) => branding?.getValue?.(row);
const soWith = (fields: Partial<ProjectSo>) => ({ branding: null, ...fields }) as ProjectSo;

describe("Sales order Branding column", () => {
  it("shows the project brand when the project has no sales order", () => {
    expect(brandingOf({ so: undefined, brand: "Dream Crafter" })).toBe("Dream Crafter");
  });

  it("shows the project brand when the sales order has no branding", () => {
    expect(brandingOf({ so: soWith({ branding: "" }), brand: "The Conts" })).toBe("The Conts");
  });

  it("keeps the sales order's branding when it has one", () => {
    expect(brandingOf({ so: soWith({ branding: "The Conts" }), brand: "Dream Crafter" })).toBe("The Conts");
  });

  it("stays empty when neither has a brand", () => {
    expect(brandingOf({ so: undefined, brand: null })).toBeNull();
  });
});
