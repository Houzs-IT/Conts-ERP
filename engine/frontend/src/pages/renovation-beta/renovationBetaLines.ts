/* The Beta PO tab as the project's line manager (owner, 24 Oct 2026). Shapes mirror
   engine/backend/src/services/renovation/betaLines.ts.

   An edit here (SKU, colour, qty, remark) is a VO: "Save & post to VO" raises it through the sales order's own
   amendment route and applies it on the spot through the same apply route the SO screen's Record VO uses
   (vendor/scm/lib/so-amendment-queries.ts createAmendmentThenApplyOwn). No approval step: a confirmed Conts order's VO
   applies when raised (backend scm/lib/renovation-vo-rule.ts). The VO is the record. */

import { api } from "../../api/client";
import { authedFetch } from "../../vendor/scm/lib/authed-fetch";
import type { CreateAmendmentLine } from "../../vendor/scm/lib/so-amendment-queries";

export type Mark = "yes" | "part" | "no";
export type GoesTo = "po" | "client" | "works";

export interface LinePo {
  poId: string; poNumber: string; poStatus: string; poLineId: string;
  poDate: string | null;
  /** The PO line's effective delivery date (backend betaLines.ts: the latest of the line's date and its supplier
      revisions, else the PO header's), the date GR and the PO itself plan on. */
  deliveryDate: string | null;
  /** A supplier revision sets deliveryDate; the line's own date can no longer move it from here. */
  supplierRevised: boolean;
  qty: number; received: number;
  photoKeys: string[];
}

export interface PendingPoChange { id: string; amendmentNo: string; poId: string; poNumber: string; voLabel: string | null }

export interface LinePlan { orderOn: string | null; deliverOn: string | null; noPo: boolean }

export interface ManagedLine {
  id: string;
  soDocNo: string;
  soStatus: string;
  voLocked: boolean;
  lineNo: number | null;
  itemCode: string;
  description: string;
  variantText: string | null;
  variants: Record<string, unknown>;
  itemGroup: string | null;
  uom: string;
  qty: number;
  unitPriceSen: number | null;
  discountSen: number | null;
  amountSen: number | null;
  area: string | null;
  remark: string | null;
  supplierName: string | null;
  goesTo: GoesTo;
  categoryLabel: string;
  categorySort: number;
  subLabel: string;
  subSort: number;
  pos: LinePo[];
  photoKeys: string[];
  skuPhotos: Array<{ productId: string; key: string; thumbKey: string | null }>;
  gr: Mark;
  do: Mark;
  plan: LinePlan;
}

export interface LinesAnswer {
  finance: boolean;
  plansReady: boolean;
  sos: Array<{ docNo: string; status: string; voLocked: boolean; renovation: boolean }>;
  lines: ManagedLine[];
  pendingPoChanges: PendingPoChange[];
}

const B = "/api/beta";

export const linesApi = {
  lines: (projectId: number): Promise<LinesAnswer> => api.get<LinesAnswer>(`${B}/projects/${projectId}/lines`),
  savePlan: (projectId: number, itemId: string, b: Partial<LinePlan>): Promise<{ ok: true; plan: LinePlan }> =>
    api.put<{ ok: true; plan: LinePlan }>(`${B}/projects/${projectId}/lines/${encodeURIComponent(itemId)}/plan`, b),
  /** The PO date, through the PO's own header update (scm mfg-purchase-orders PATCH /:id). */
  setPoDate: (poId: string, poDate: string): Promise<unknown> =>
    authedFetch(`/mfg-purchase-orders/${encodeURIComponent(poId)}`, { method: "PATCH", body: JSON.stringify({ poDate }) }),
  /** A PO line's delivery date, through the PO's own line update (PATCH /:id/items/:itemId). */
  setPoLineDelivery: (poId: string, poLineId: string, deliveryDate: string | null): Promise<unknown> =>
    authedFetch(`/mfg-purchase-orders/${encodeURIComponent(poId)}/items/${encodeURIComponent(poLineId)}`, { method: "PATCH", body: JSON.stringify({ deliveryDate }) }),
  /** Confirms a PO change a VO raised (scm po-amendments PATCH /:id/approve; needs scm.po_amendment.approve). */
  confirmPoChange: (amendmentId: string): Promise<unknown> =>
    authedFetch(`/po-amendments/${encodeURIComponent(amendmentId)}/approve`, { method: "PATCH" }),
};

/* ---------- edits ---------- */

/** What the screen lets you change on a line. Absent = unchanged. */
export interface LineEdit {
  itemCode?: string;
  /** The picked SKU's name and sell price, for the amount shown before saving. */
  pickedName?: string;
  pickedPriceSen?: number;
  colour?: string;
  qty?: number;
  remark?: string;
}

/** The colour as a line holds it: the variant key the order's summary prints (variant-summary.ts colorCode). */
export function colourOf(l: Pick<ManagedLine, "variants">): string {
  const v = l.variants.colorCode;
  return typeof v === "string" ? v : "";
}

/** A sofa or bedframe picks its fabric and heights on the order's own configurator; only the remark, qty and SKU
    change here for those lines. */
export function colourEditable(l: Pick<ManagedLine, "itemGroup" | "variants">): boolean {
  const g = String(l.itemGroup ?? "").toLowerCase();
  if (g.includes("sofa") || g.includes("bedframe")) return false;
  return !l.variants.fabricCode;
}

/** The edit with every field equal to the line dropped; null when nothing moved. */
export function effectiveEdit(l: ManagedLine, e: LineEdit | undefined): LineEdit | null {
  if (!e) return null;
  const out: LineEdit = {};
  if (e.itemCode !== undefined && e.itemCode.trim() && e.itemCode.trim() !== l.itemCode) {
    out.itemCode = e.itemCode.trim();
    if (e.pickedName !== undefined) out.pickedName = e.pickedName;
    if (e.pickedPriceSen !== undefined) out.pickedPriceSen = e.pickedPriceSen;
  }
  if (e.colour !== undefined && e.colour.trim() !== colourOf(l).trim()) out.colour = e.colour.trim();
  if (e.qty !== undefined && Number.isFinite(e.qty) && e.qty !== l.qty) out.qty = e.qty;
  if (e.remark !== undefined && e.remark.trim() !== (l.remark ?? "").trim()) out.remark = e.remark.trim();
  return Object.keys(out).length ? out : null;
}

/** The unit price after the edit, by the SO edit's own rule: a picked SKU starts at its catalog sell price
    (SoLineCard pickProduct), a qty change keeps the line's price. The server re-derives it when the VO applies. */
export function unitAfter(l: ManagedLine, e: LineEdit | null): number | null {
  if (l.unitPriceSen === null) return null;
  if (e?.itemCode && e.pickedPriceSen !== undefined) return e.pickedPriceSen;
  return l.unitPriceSen;
}

/** The line amount after the edit: qty x unit less the line's discount (never below zero). */
export function amountAfter(l: ManagedLine, e: LineEdit | null): number | null {
  const unit = unitAfter(l, e);
  if (unit === null || l.amountSen === null) return null;
  if (!e || (e.qty === undefined && e.itemCode === undefined)) return l.amountSen;
  const qty = e.qty ?? l.qty;
  return Math.max(0, qty * unit - (l.discountSen ?? 0));
}

export function editProblem(e: LineEdit | null): string | null {
  if (!e) return null;
  if (e.qty !== undefined && (!Number.isInteger(e.qty) || e.qty < 1)) return "Qty must be a whole number, 1 or more.";
  return null;
}

/** The change in words, for the confirm list. */
export function editWords(l: ManagedLine, e: LineEdit): string[] {
  const out: string[] = [];
  if (e.itemCode) out.push(`SKU ${l.itemCode} -> ${e.itemCode}${e.pickedName ? ` (${e.pickedName})` : ""}`);
  if (e.colour !== undefined) out.push(`Colour ${colourOf(l) || "none"} -> ${e.colour || "none"}`);
  if (e.qty !== undefined) out.push(`Qty ${l.qty} -> ${e.qty}`);
  if (e.remark !== undefined) out.push(e.remark ? `Remark: ${e.remark}` : "Remark cleared");
  return out;
}

/** One VO line for an edited SO line, in the shape the SO screen's Record VO sends (SalesOrderDetail
    buildAmendmentLines): QTY when only the qty moved, else SPEC with the whole variants blob; the remark only when it
    moved; the old values as the snapshot. */
export function amendmentLine(l: ManagedLine, e: LineEdit): CreateAmendmentLine {
  const variants: Record<string, unknown> = { ...l.variants };
  delete variants.remark;
  if (e.colour !== undefined) {
    if (e.colour) variants.colorCode = e.colour;
    else delete variants.colorCode;
  }
  const qtyOnly = e.qty !== undefined && e.itemCode === undefined && e.colour === undefined && e.remark === undefined;
  const unit = unitAfter(l, e);
  return {
    salesOrderItemId: l.id,
    changeType: qtyOnly ? "QTY" : "SPEC",
    newItemCode: e.itemCode ?? l.itemCode,
    newVariants: variants,
    newQty: e.qty ?? l.qty,
    ...(unit !== null ? { newUnitPriceSen: unit } : {}),
    ...(e.remark !== undefined ? { newRemark: e.remark } : {}),
    oldSnapshot: { itemCode: l.itemCode, variants: l.variants, qty: l.qty, unitPriceSen: l.unitPriceSen, description2: l.variantText },
  };
}

export interface VoBatch { docNo: string; reason: string; lines: CreateAmendmentLine[]; words: string[] }

/** One VO per sales order for everything edited on it. */
export function voBatches(lines: readonly ManagedLine[], edits: Readonly<Record<string, LineEdit>>): VoBatch[] {
  const by = new Map<string, VoBatch>();
  for (const l of lines) {
    const e = effectiveEdit(l, edits[l.id]);
    if (!e || !l.voLocked) continue;
    const b = by.get(l.soDocNo) ?? { docNo: l.soDocNo, reason: "", lines: [], words: [] };
    b.lines.push(amendmentLine(l, e));
    b.words.push(`${l.itemCode}: ${editWords(l, e).join("; ")}`);
    by.set(l.soDocNo, b);
  }
  return [...by.values()].map((b) => ({
    ...b,
    reason: `Changed on the project PO tab: ${b.words.join(" | ")}`.slice(0, 1000),
  }));
}

/* ---------- posting ---------- */

/** The server's own sentence from a refused call (authedFetch keeps the raw body on the error). */
export function refusalText(e: unknown): string {
  const err = e as { body?: string; message?: string } | null;
  if (err?.body) {
    try {
      const b = JSON.parse(err.body) as { message?: string; reason?: string };
      if (b.reason || b.message) return String(b.reason ?? b.message);
    } catch { /* not JSON */ }
  }
  return err?.message || "The change could not be saved.";
}

export interface PostedVo {
  docNo: string;
  amendmentNo: string | null;
  applied: boolean;
  /** Set when the order refused the change; the VO was withdrawn so the next one is not blocked. */
  refusal: string | null;
  followUps: Array<{ poNumber: string; amendmentNo: string }>;
}

interface CreatedVo { amendment?: { id: string; amendment_no: string }; amendments?: Array<{ id: string; amendment_no: string }>; selfApprovable?: string[] }
interface AppliedVo { poFollowUps?: Array<{ poNumber: string; amendmentNo: string }> }

/** Raise the VO and apply it. A VO the order refuses to apply (a received or delivered line, say) is withdrawn with
    the reason, so it does not sit open and block the next save. */
export async function postVo(b: VoBatch, idempotencyKey: string): Promise<PostedVo> {
  let created: CreatedVo;
  try {
    created = await authedFetch<CreatedVo>(`/mfg-sales-orders/${encodeURIComponent(b.docNo)}/amendments`, {
      method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ reason: b.reason, lines: b.lines }),
    });
  } catch (e) {
    return { docNo: b.docNo, amendmentNo: null, applied: false, refusal: refusalText(e), followUps: [] };
  }
  const all = created.amendments ?? (created.amendment ? [created.amendment] : []);
  const out: PostedVo = { docNo: b.docNo, amendmentNo: all.map((a) => a.amendment_no).join(", ") || null, applied: true, refusal: null, followUps: [] };
  const ids = created.selfApprovable ?? [];
  if (ids.length < all.length) {
    out.applied = false;
    out.refusal = "This VO was recorded but could not be applied for you: your account cannot apply sales order changes.";
  }
  for (const id of ids) {
    try {
      const r = await authedFetch<AppliedVo>(`/so-amendments/${encodeURIComponent(id)}/approve-so`, { method: "PATCH" });
      out.followUps.push(...(r.poFollowUps ?? []));
    } catch (e) {
      out.applied = false;
      out.refusal = refusalText(e);
      try {
        await authedFetch(`/so-amendments/${encodeURIComponent(id)}/withdraw`, { method: "PATCH", body: JSON.stringify({ reason: `Not applied: ${out.refusal}`.slice(0, 500) }) });
      } catch { /* it stays open; the VO tab shows it */ }
    }
  }
  return out;
}

/* ---------- grouping ---------- */

export interface CategoryBlock { key: string; label: string; count: number; subs: Array<{ key: string; label: string; items: ManagedLine[] }> }

export function byCategory(items: readonly ManagedLine[]): CategoryBlock[] {
  const cats = new Map<string, { sort: number; subs: Map<string, { sort: number; items: ManagedLine[] }> }>();
  for (const i of items) {
    const c = cats.get(i.categoryLabel) ?? { sort: i.categorySort, subs: new Map() };
    const s = c.subs.get(i.subLabel) ?? { sort: i.subSort, items: [] };
    s.items.push(i);
    c.subs.set(i.subLabel, s);
    cats.set(i.categoryLabel, c);
  }
  return [...cats.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
    .map(([label, c]) => {
      const subs = [...c.subs.entries()].sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
        .map(([sl, s]) => ({ key: `${label}/${sl}`, label: sl, items: s.items }));
      return { key: label, label, subs, count: subs.reduce((n, s) => n + s.items.length, 0) };
    });
}

/** The live PO holding the line, if any. */
export function livePo(l: Pick<ManagedLine, "pos">): LinePo | null {
  return l.pos.find((p) => p.poStatus !== "CANCELLED") ?? null;
}

/** A line's dates. Processing (when to order) is always the line's own plan. Delivery is the PO line's once a PO
    holds it (changed on the PO), else the plan. */
export function lineDates(l: ManagedLine): { orderOn: string | null; deliverOn: string | null; fromPo: LinePo | null } {
  const po = livePo(l);
  return { orderOn: l.plan.orderOn, deliverOn: po ? po.deliveryDate : l.plan.deliverOn, fromPo: po };
}

/** Whether the line's date can be set from here: processing is the line's plan; delivery is the PO line's once a PO
    holds it (unless a supplier revision governs it), else the plan. */
export function dateSettable(l: ManagedLine, which: "orderOn" | "deliverOn", plansReady: boolean): boolean {
  if (!l.voLocked) return false;
  const po = livePo(l);
  if (which === "deliverOn" && po) return !po.supplierRevised;
  return plansReady;
}

/** A category's or sub-category's date: the one date every line shares, "mixed" when they differ (a line with no
    date counts as different from one with a date), null when none has one. */
export function groupDate(lines: readonly ManagedLine[], which: "orderOn" | "deliverOn"): string | "mixed" | null {
  if (lines.length === 0) return null;
  const vals = new Set(lines.map((l) => lineDates(l)[which] ?? ""));
  if (vals.size > 1) return "mixed";
  return [...vals][0] || null;
}

/** The earliest and latest of a group's dates and how many lines have none, for a band whose lines differ. */
export function groupRange(lines: readonly ManagedLine[], which: "orderOn" | "deliverOn"): { from: string | null; to: string | null; unset: number } {
  const days = lines.map((l) => lineDates(l)[which]).filter((x): x is string => !!x).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null, unset: lines.length - days.length };
}

/** The lines a group date sets: those whose date can be set here and differs from the new one. */
export function groupDateTargets(lines: readonly ManagedLine[], which: "orderOn" | "deliverOn", value: string | null, plansReady: boolean): ManagedLine[] {
  return lines.filter((l) => dateSettable(l, which, plansReady) && (lineDates(l)[which] ?? null) !== value);
}

/** Late: the order date has passed with no PO, or the delivery date has passed with nothing delivered. */
export function lineLate(l: ManagedLine, today: string): "order" | "deliver" | null {
  const d = lineDates(l);
  if (!d.fromPo && !l.plan.noPo && l.goesTo === "po" && d.orderOn && d.orderOn < today) return "order";
  if (l.do !== "yes" && d.deliverOn && d.deliverOn < today) return "deliver";
  return null;
}

/* ---------- export ---------- */

const csvCell = (v: unknown): string => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function linesCsv(lines: readonly ManagedLine[], finance: boolean): string {
  const head = ["SO", "Category", "Sub-category", "SKU", "Description", "Variants", "Colour", "Area", "Remark", "UOM", "Qty",
    ...(finance ? ["Amount (RM)"] : []), "Processing date", "Delivery date", "PO", "PO date", "GR", "DO"];
  const out = [head];
  for (const l of lines) {
    const d = lineDates(l);
    out.push([l.soDocNo, l.categoryLabel, l.subLabel, l.itemCode, l.description, l.variantText ?? "", colourOf(l), l.area ?? "", l.remark ?? "", l.uom, String(l.qty),
      ...(finance ? [l.amountSen === null ? "" : (l.amountSen / 100).toFixed(2)] : []),
      d.orderOn ?? "", d.deliverOn ?? "", l.pos.filter((p) => p.poStatus !== "CANCELLED").map((p) => p.poNumber).join(" "), d.fromPo?.poDate ?? "",
      l.goesTo === "po" || l.pos.length ? l.gr : "", l.do]);
  }
  return out.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/* ---------- by area ---------- */

export const NO_AREA = "No area";

/** Lines by the SO line's area (room), in first-seen order; lines with no area last. */
export function byAreaBlocks(items: readonly ManagedLine[]): CategoryBlock[] {
  const m = new Map<string, ManagedLine[]>();
  for (const i of items) {
    const k = i.area?.trim() || NO_AREA;
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...m.entries()]
    .sort((a, b) => Number(a[0] === NO_AREA) - Number(b[0] === NO_AREA))
    .map(([label, list]) => ({ key: `area:${label}`, label, count: list.length, subs: [{ key: `area:${label}/`, label: "", items: list }] }));
}
