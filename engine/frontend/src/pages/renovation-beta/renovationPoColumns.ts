/* The project PO tab's columns can be moved (owner, 1 Nov 2026). The order follows the account through the same stored
   layouts as every DataTable (lib/tableLayouts.ts): localStorage is read first, the server is a sync channel. */
import { useCallback, useState } from "react";
import { getActiveCompanyId } from "../../lib/activeCompany";
import { EMPTY_LAYOUT, layoutIdKey, saveMyLayout } from "../../lib/tableLayouts";

export type PoColumn = "sku" | "desc" | "variants" | "qty" | "amount" | "orderOn" | "deliverOn" | "supplier" | "warehouse" | "stock" | "po" | "gr" | "do";

export const PO_COLUMNS: readonly PoColumn[] = ["sku", "desc", "variants", "qty", "amount", "orderOn", "deliverOn", "supplier", "warehouse", "stock", "po", "gr", "do"];

const TABLE_KEY = "reno-po-tab";

/** Column widths (percent of the table), with and without the Amount column. */
const WIDTHS: Record<PoColumn, readonly [number, number]> = {
  sku: [10, 12], desc: [15, 18], variants: [6, 7], qty: [4, 4.5], amount: [7, 0], orderOn: [7.5, 8], deliverOn: [7.5, 8], supplier: [10, 11], warehouse: [8, 9], stock: [6.5, 7], po: [11, 12], gr: [9, 10], do: [8, 8.5],
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

/* The categories can be dragged up and down too, so the one worked on first sits on top (owner, 17 Nov 2026). The
   order follows the account the same way as the columns, and holds on every project. A category not in the saved
   order keeps its usual place after the saved ones. */
const CATEGORY_KEY = "reno-po-tab-categories";

/** The blocks in the saved order; the rest after them in their usual order. */
export function orderCategories<T extends { key: string }>(blocks: readonly T[], saved: readonly string[]): T[] {
  const rank = new Map(saved.map((k, i) => [k, i]));
  return blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (rank.get(x.b.key) ?? saved.length + x.i) - (rank.get(y.b.key) ?? saved.length + y.i))
    .map((x) => x.b);
}

/** The shown order with `from` dropped where `to` was. */
export function moveCategory(shown: readonly string[], from: string, to: string): string[] {
  if (from === to) return [...shown];
  const out = shown.filter((k) => k !== from);
  out.splice(shown.indexOf(to), 0, from);
  return out;
}

function readCategoryOrder(): string[] {
  try {
    const raw = localStorage.getItem(`dt:order:${layoutIdKey(CATEGORY_KEY, getActiveCompanyId())}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** The saved category order and its setter; `null` puts the usual order back. */
export function usePoCategoryOrder(): { saved: string[]; setSaved: (next: string[] | null) => void } {
  const [saved, set] = useState(readCategoryOrder);
  const setSaved = useCallback((next: string[] | null) => {
    const kept = next ?? [];
    set(kept);
    try {
      localStorage.setItem(`dt:order:${layoutIdKey(CATEGORY_KEY, getActiveCompanyId())}`, JSON.stringify(kept));
    } catch { /* this browser just won't remember it */ }
    saveMyLayout(CATEGORY_KEY, { ...EMPTY_LAYOUT, order: kept });
  }, []);
  return { saved, setSaved };
}

/* Column widths can be dragged too (owner, 17 Nov 2026: "我不能 adjust column?"): a column's own share of the table, in
   percent, follows the account like the order. A column never set keeps its usual width. */
const WIDTHS_KEY = "reno-po-tab-widths";
export const MIN_COLUMN_PCT = 3;

function readWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(`dt:widths:${layoutIdKey(WIDTHS_KEY, getActiveCompanyId())}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "number" && v >= MIN_COLUMN_PCT)) as Record<string, number>;
  } catch {
    return {};
  }
}

/** The saved widths, the width of a column (saved, else usual) and the setter; `null` puts the usual widths back. */
export function usePoColumnWidths(): { widths: Record<string, number>; widthOf: (c: PoColumn, finance: boolean) => number; setWidths: (next: Record<string, number> | null) => void } {
  const [widths, set] = useState(readWidths);
  const setWidths = useCallback((next: Record<string, number> | null) => {
    const kept = next ?? {};
    set(kept);
    try {
      localStorage.setItem(`dt:widths:${layoutIdKey(WIDTHS_KEY, getActiveCompanyId())}`, JSON.stringify(kept));
    } catch { /* this browser just won't remember it */ }
    saveMyLayout(WIDTHS_KEY, { ...EMPTY_LAYOUT, widths: kept });
  }, []);
  const widthOf = useCallback((c: PoColumn, finance: boolean) => widths[c] ?? columnWidth(c, finance), [widths]);
  return { widths, widthOf, setWidths };
}

/* Order by date, then by hand (owner, 17 Nov 2026): categories, subcategories and lines sort by their earliest
   processing date (then delivery date; no date last), so the first to start is on top. A band or line someone dragged
   keeps the place they gave it: the hand order wins, the rest follow the dates. Category and subcategory order follow
   the account; line order is the project's own (its lines are), kept per account too. */
type Dated = { plan: { orderOn: string | null; deliverOn: string | null } };
const NO_DATE = "9999-99-99";
export const dateKey = (l: Dated): string => `${l.plan.orderOn ?? NO_DATE}|${l.plan.deliverOn ?? NO_DATE}`;
const earliest = (ls: readonly Dated[]): string => ls.reduce((m, l) => (dateKey(l) < m ? dateKey(l) : m), `${NO_DATE}|${NO_DATE}`);

/** Blocks and their subs and lines in date order (a stable sort: same dates keep their usual order). */
export function sortByDates<L extends Dated & { id: string }, B extends { key: string; subs: Array<{ key: string; items: L[] }> }>(blocks: readonly B[]): B[] {
  return blocks
    .map((b) => ({
      ...b,
      subs: b.subs
        .map((s) => ({ ...s, items: [...s.items].sort((x, y) => dateKey(x).localeCompare(dateKey(y))) }))
        .sort((x, y) => earliest(x.items).localeCompare(earliest(y.items))),
    }))
    .sort((x, y) => earliest(x.subs.flatMap((s) => s.items)).localeCompare(earliest(y.subs.flatMap((s) => s.items))));
}

export interface HandOrder { cats: string[]; subs: Record<string, string[]>; lines: Record<string, string[]> }

/** The hand order on top of the date order. */
export function applyHandOrder<L extends { id: string }, B extends { key: string; subs: Array<{ key: string; items: L[] }> }>(blocks: readonly B[], hand: HandOrder): B[] {
  return orderCategories(blocks, hand.cats).map((b) => ({
    ...b,
    subs: orderCategories(b.subs, hand.subs[b.key] ?? []).map((s) => {
      const saved = hand.lines[s.key];
      return saved ? { ...s, items: orderCategories(s.items.map((l) => ({ ...l, key: l.id })), saved).map(({ key: _k, ...l }) => l as unknown as L) } : s;
    }),
  }));
}

const HAND_KEY = "reno-po-tab-hand-order";

function readHand(projectId: number): HandOrder {
  const empty: HandOrder = { cats: [], subs: {}, lines: {} };
  try {
    const raw = localStorage.getItem(`dt:order:${layoutIdKey(HAND_KEY, getActiveCompanyId())}`);
    const all = raw ? (JSON.parse(raw) as { cats?: unknown; subs?: unknown; lines?: Record<string, unknown> }) : {};
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
    const map = (v: unknown): Record<string, string[]> => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, strings(x)])) : {});
    return { cats: strings(all.cats), subs: map(all.subs), lines: map(all.lines?.[String(projectId)]) };
  } catch {
    return empty;
  }
}

/** The hand order for this project, and setters for each level; `reset()` goes back to the date order. */
export function useHandOrder(projectId: number): {
  hand: HandOrder; moved: boolean;
  setCats: (keys: string[]) => void; setSubs: (cat: string, keys: string[]) => void; setLines: (sub: string, ids: string[]) => void; reset: () => void;
} {
  const [hand, set] = useState<HandOrder>(() => readHand(projectId));
  const save = useCallback((next: HandOrder) => {
    set(next);
    try {
      const k = `dt:order:${layoutIdKey(HAND_KEY, getActiveCompanyId())}`;
      const raw = localStorage.getItem(k);
      const all = raw ? (JSON.parse(raw) as { lines?: Record<string, Record<string, string[]>> }) : {};
      const stored = { cats: next.cats, subs: next.subs, lines: { ...(all.lines ?? {}), [String(projectId)]: next.lines } };
      localStorage.setItem(k, JSON.stringify(stored));
      saveMyLayout(HAND_KEY, { ...EMPTY_LAYOUT, order: next.cats });
    } catch { /* this browser just won't remember it */ }
  }, [projectId]);
  return {
    hand,
    moved: hand.cats.length > 0 || Object.keys(hand.subs).length > 0 || Object.keys(hand.lines).length > 0,
    setCats: (keys) => save({ ...hand, cats: keys }),
    setSubs: (cat, keys) => save({ ...hand, subs: { ...hand.subs, [cat]: keys } }),
    setLines: (sub, ids) => save({ ...hand, lines: { ...hand.lines, [sub]: ids } }),
    reset: () => save({ cats: [], subs: {}, lines: {} }),
  };
}
