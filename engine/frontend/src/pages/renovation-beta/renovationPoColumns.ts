/* The project PO tab's columns can be moved (owner, 1 Nov 2026). The order follows the account through the same stored
   layouts as every DataTable (lib/tableLayouts.ts): localStorage is read first, the server is a sync channel. */
import { useCallback, useState } from "react";
import { getActiveCompanyId } from "../../lib/activeCompany";
import { EMPTY_LAYOUT, layoutIdKey, saveMyLayout } from "../../lib/tableLayouts";

export type PoColumn = "sku" | "desc" | "variants" | "qty" | "amount" | "orderOn" | "deliverOn" | "supplier" | "po" | "gr" | "do";

export const PO_COLUMNS: readonly PoColumn[] = ["sku", "desc", "variants", "qty", "amount", "orderOn", "deliverOn", "supplier", "po", "gr", "do"];

const TABLE_KEY = "reno-po-tab";

/** Column widths (percent of the table), with and without the Amount column. */
const WIDTHS: Record<PoColumn, readonly [number, number]> = {
  sku: [9, 11], desc: [14, 18], variants: [6.5, 8], qty: [4, 4.5], amount: [7.5, 0], orderOn: [7.5, 8], deliverOn: [7.5, 8], supplier: [11, 11], po: [11.5, 12], gr: [11, 10.5], do: [10.5, 9],
};

export const columnWidth = (c: PoColumn, finance: boolean): number => WIDTHS[c][finance ? 0 : 1];

/** A saved order made fit to read: unknown names dropped, a missing column back at its usual place. */
export function normalizeOrder(saved: readonly string[]): PoColumn[] {
  const out = saved.filter((c, i): c is PoColumn => (PO_COLUMNS as readonly string[]).includes(c) && saved.indexOf(c) === i);
  PO_COLUMNS.forEach((c, i) => { if (!out.includes(c)) out.splice(Math.min(i, out.length), 0, c); });
  return out;
}

export function moveColumn(order: readonly PoColumn[], from: PoColumn, to: PoColumn): PoColumn[] {
  if (from === to) return [...order];
  const out = order.filter((c) => c !== from);
  out.splice(order.indexOf(to), 0, from);
  return out;
}

export type BandPart = { kind: "label" | "blank"; span: number } | { kind: "orderOn" | "deliverOn"; span: 1 };

/** A category band's cells: its dates sit under their columns, and the label takes the first run of other columns. */
export function bandParts(columns: readonly PoColumn[]): BandPart[] {
  const parts: BandPart[] = [];
  let labelled = false;
  for (const c of columns) {
    const last = parts[parts.length - 1];
    if (c === "orderOn" || c === "deliverOn") parts.push({ kind: c, span: 1 });
    else if (last && (last.kind === "label" || last.kind === "blank")) last.span += 1;
    else { parts.push({ kind: labelled ? "blank" : "label", span: 1 }); labelled = true; }
  }
  return parts;
}

function readOrder(): PoColumn[] {
  try {
    const raw = localStorage.getItem(`dt:order:${layoutIdKey(TABLE_KEY, getActiveCompanyId())}`);
    return normalizeOrder(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return [...PO_COLUMNS];
  }
}

/** The column order and its setter; `null` puts the usual order back. */
export function usePoColumns(): { order: PoColumn[]; moved: boolean; setOrder: (next: PoColumn[] | null) => void } {
  const [order, set] = useState(readOrder);
  const setOrder = useCallback((next: PoColumn[] | null) => {
    set(next ?? [...PO_COLUMNS]);
    const kept = next ?? [];
    try {
      localStorage.setItem(`dt:order:${layoutIdKey(TABLE_KEY, getActiveCompanyId())}`, JSON.stringify(kept));
    } catch { /* this browser just won't remember it */ }
    saveMyLayout(TABLE_KEY, { ...EMPTY_LAYOUT, order: kept });
  }, []);
  return { order, moved: order.some((c, i) => c !== PO_COLUMNS[i]), setOrder };
}
