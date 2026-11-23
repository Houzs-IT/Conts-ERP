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

describe("Sales order Paid and Balance columns", () => {
  type P = { so: ProjectSo | undefined; outstandingSen: number | null };
  const cols = soColumns<P>((row) => row.so, (row) => ({ brand: null, outstandingSen: row.outstandingSen }));
  const of = (key: string, row: P) => cols.find((c) => c.key === key)?.getValue?.(row);
  const so = soWith({ local_total_sen: 2_053_400, paid_total_sen: 0, balance_sen_live: 2_053_400 });

  it("follow the board's figure, which counts what AutoCount collected (chew, 18 Nov 2026)", () => {
    expect(of("so_balance", { so, outstandingSen: 1_243_760 })).toBe(1_243_760);
    expect(of("so_paid", { so, outstandingSen: 1_243_760 })).toBe(809_640);
  });

  it("fall back to the order's own figures when the board has none", () => {
    expect(of("so_balance", { so, outstandingSen: null })).toBe(2_053_400);
    expect(of("so_paid", { so, outstandingSen: null })).toBe(0);
  });
});
