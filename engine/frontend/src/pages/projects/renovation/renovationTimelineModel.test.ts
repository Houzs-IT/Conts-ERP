import { describe, expect, test } from "vitest";
import { CATEGORY_LABEL, FILTERS, NOTE_TYPES, countByCategory, filterEntries, type TimelineEntry } from "./renovationTimelineModel";

const e = (id: string, category: TimelineEntry["category"]): TimelineEntry => ({ id, at: "2026-10-15T00:00:00Z", dateOnly: false, category, title: null, body: id, by: null });
const list = [e("a", "system"), e("b", "customer"), e("c", "system"), e("d", "site")];

describe("renovation timeline model", () => {
  test("chips: All, System, then the five note types, each with a label", () => {
    expect(FILTERS).toEqual(["all", "system", "customer", "design", "supplier", "site", "sales"]);
    expect(NOTE_TYPES.map((t) => CATEGORY_LABEL[t])).toEqual(["Customer", "Design", "Supplier", "Site", "Sales"]);
  });
  test("a chip shows only its category; All keeps the order", () => {
    expect(filterEntries(list, "all").map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterEntries(list, "system").map((x) => x.id)).toEqual(["a", "c"]);
    expect(filterEntries(list, "sales")).toEqual([]);
  });
  test("counts per chip", () => {
    expect(countByCategory(list)).toEqual({ all: 4, system: 2, customer: 1, design: 0, supplier: 0, site: 1, sales: 0 });
  });
});
