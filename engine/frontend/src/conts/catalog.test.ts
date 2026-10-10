import { describe, expect, test } from "vitest";
import {
  CONTS_HIDDEN_MAINTENANCE_KEYS,
  CONTS_HIDDEN_PRODUCT_TABS,
  CONTS_RENOVATION_CATALOG,
  resolveProductTab,
  visibleProductTabs,
} from "./catalog";

const ALL = ["sku", "modular", "maintenance", "combos", "variants", "fabric", "categories"] as const;

describe("Conts renovation catalog switch", () => {
  test("is on in this instance", () => {
    expect(CONTS_RENOVATION_CATALOG).toBe(true);
  });

  test("hides Modular, Fabric Converter and Categories; keeps the rest in order", () => {
    expect([...CONTS_HIDDEN_PRODUCT_TABS].sort()).toEqual(["categories", "fabric", "modular"]);
    const tabs = ALL.map((value) => ({ value, label: value }));
    expect(visibleProductTabs(tabs).map((t) => t.value)).toEqual(["sku", "maintenance", "combos", "variants"]);
  });

  test("a hidden or unknown ?tab falls back to the SKU Master", () => {
    expect(resolveProductTab("fabric", ALL)).toBe("sku");
    expect(resolveProductTab("modular", ALL)).toBe("sku");
    expect(resolveProductTab("nonsense", ALL)).toBe("sku");
    expect(resolveProductTab(null, ALL)).toBe("sku");
    expect(resolveProductTab("variants", ALL)).toBe("variants");
  });

  test("hides the Fabrics maintenance list", () => {
    expect(CONTS_HIDDEN_MAINTENANCE_KEYS.has("fabrics")).toBe(true);
    expect(CONTS_HIDDEN_MAINTENANCE_KEYS.has("brandings")).toBe(false);
  });
});
