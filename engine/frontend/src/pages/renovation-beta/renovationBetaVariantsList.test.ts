import { describe, expect, it } from "vitest";
import { variantRows } from "./renovationBetaVariantsList";
import type { DesignProject } from "./renovationBetaBoard";

const project = (id: number, pending: DesignProject["variants"]["pending"]): DesignProject =>
  ({ id, title: `P${id}`, variants: { lines: 5, missing: pending.length, pending } } as unknown as DesignProject);

describe("Variants as a list of SKUs", () => {
  it("lists one row per line still to pick, the project with it, in the projects' order", () => {
    const rows = variantRows([
      project(1, [{ itemCode: "SOF-A", missing: ["Fabrics"], id: "11", docNo: "SO-1" }, { itemCode: "BED-B", missing: ["Gap"], id: "12", docNo: "SO-1" }]),
      project(2, [{ itemCode: "SOF-C", missing: ["Seat Size"], id: "21", docNo: "SO-2" }]),
    ]);
    expect(rows.map((r) => `${r.p.id}:${r.line.itemCode}`)).toEqual(["1:SOF-A", "1:BED-B", "2:SOF-C"]);
  });
  it("skips lines an older server sent without their SO line", () => {
    expect(variantRows([project(1, [{ itemCode: "SOF-A", missing: ["Fabrics"] }])])).toEqual([]);
  });
});
