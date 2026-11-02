/* The SO line's variant pickers, outside the SO line card (owner, 2 Nov 2026: the project PO tab changes a line's
   variants with the same dropdowns as the SO). The fields, their option lists and what a pick writes are the SO
   card's own (SoLineCard.tsx): the Fabrics combobox and VariantSelect it exports, fed by the master Maintenance
   pools and narrowed by the SKU Model's allowed options, through the same shared helpers. A fabric pick writes the
   keys pickFabricColour writes; the bedframe total height follows Divan + Leg + Gap (shared/total-height). Special
   add-ons are not offered here: they move the price, which a contract line keeps. */
import { activeOptions, maintPickerValues } from "@2990s/shared";
import { restrictPricedToPool, restrictStringsToPool } from "../../shared/maintenance-pools";
import { computeTotalHeight, totalHeightPatch } from "../../shared/total-height";
import { useMaintenanceConfig, useModelAllowedOptionsByCode } from "../lib/mfg-products-queries";
import { useFabricLibrary } from "../lib/queries";
import type { FabricColourRow } from "../lib/fabric-queries";
import { sortByNumeric } from "../lib/sort-options";
import { FabricColourCombobox, VariantSelect } from "./SoLineCard";
import styles from "./SoLineCard.module.css";

/** The variant categories that have pickers on the SO line (SoLineCard hasVariants). */
export const PICKER_CATEGORIES = ["sofa", "bedframe", "fabric_accessory"] as const;
export const hasVariantPickers = (category: string | null | undefined): boolean =>
  (PICKER_CATEGORIES as readonly string[]).includes(String(category ?? "").toLowerCase());

const NO_INACTIVE = new Set<string>();

export function RenovationVariantPicker({ category, itemCode, variants, onPatch }: {
  category: string;
  itemCode: string;
  variants: Record<string, unknown>;
  /** Called with the keys a pick changes (several at once for a fabric). */
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const cat = category.toLowerCase();
  const maint = useMaintenanceConfig("master").data?.data ?? null;
  const allowOpts = useModelAllowedOptionsByCode(itemCode || undefined).data ?? null;
  const fabricLib = useFabricLibrary().data ?? [];
  const v = (k: string): string => String(variants[k] ?? "");

  /* A height pick also moves the bedframe total height, in the same patch. */
  const patch = (p: Record<string, unknown>): void => {
    const next = { ...variants, ...p };
    onPatch({ ...p, ...(totalHeightPatch(cat, next) ?? {}) });
  };
  const pickFabric = (c: FabricColourRow): void => {
    const seriesLabel = fabricLib.find((f) => f.id === c.fabricId)?.label ?? null;
    patch({
      fabricCode: c.colourId, colourId: c.colourId, fabricId: c.fabricId,
      ...(seriesLabel ? { fabricLabel: seriesLabel } : {}),
      ...(c.label ? { colourLabel: c.label } : {}),
      ...(c.swatchHex ? { colourHex: c.swatchHex } : {}),
    });
  };

  if (!maint) return <p style={{ margin: 0, fontSize: 13 }}>Loading the option lists...</p>;
  const fabric = (
    <FabricColourCombobox label="Fabrics" value={v("fabricCode")} pool={allowOpts?.fabrics ?? null} inactiveCodes={NO_INACTIVE}
      itemCode={itemCode || null} onSelect={pickFabric} />
  );
  const total = computeTotalHeight(cat, variants);
  return (
    <div className={styles.variants}>
      <div className={styles.variantsGrid}>
        {fabric}
        {cat === "bedframe" && (
          <>
            <VariantSelect label="Gaps" value={v("gap")}
              options={sortByNumeric(restrictStringsToPool(maintPickerValues(maint.gaps, v("gap")), allowOpts?.gaps).map((g) => ({ value: g, priceSen: 0 })))}
              onChange={(x) => patch({ gap: x })} />
            <VariantSelect label="Divan Heights" value={v("divanHeight")}
              options={sortByNumeric(restrictPricedToPool(activeOptions(maint.divanHeights, v("divanHeight")), allowOpts?.divan_heights))}
              onChange={(x) => patch({ divanHeight: x })} />
            <VariantSelect label="Leg Heights" value={v("legHeight")}
              options={sortByNumeric(restrictPricedToPool(activeOptions(maint.legHeights, v("legHeight")), allowOpts?.leg_heights))}
              onChange={(x) => patch({ legHeight: x })} />
          </>
        )}
        {cat === "sofa" && (
          <>
            <VariantSelect label="Seat Size" value={v("seatHeight")}
              options={sortByNumeric(restrictStringsToPool(maintPickerValues(maint.sofaSizes, v("seatHeight")), allowOpts?.sizes).map((s) => ({ value: s, priceSen: 0 })))}
              onChange={(x) => patch({ seatHeight: x })} />
            <VariantSelect label="Leg Heights" value={v("legHeight")}
              options={sortByNumeric(restrictPricedToPool(activeOptions(maint.sofaLegHeights, v("legHeight")), allowOpts?.leg_heights))}
              onChange={(x) => patch({ legHeight: x })} />
          </>
        )}
      </div>
      {cat === "bedframe" && total && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-muted)" }}>
          Total height (auto): <strong style={{ fontVariantNumeric: "tabular-nums" }}>{total}</strong> (Divan + Leg + Gap)
        </div>
      )}
    </div>
  );
}
