/* Calls and grouping for the Beta workspace's VO, PO and Client PO tabs (owner, 24 Oct 2026).
   Shapes mirror engine/backend/src/services/renovation/betaVoPo.ts. */

import { api } from "../../api/client";

export type VoBucket = "pending" | "approved" | "closed";
/** po: we buy it; client: the client buys it; works: our own works or service, nothing is bought. */
export type GoesTo = "po" | "client" | "works";

export interface VoLine {
  itemCode: string | null;
  description: string;
  room: string | null;
  qty: number;
  measure: string | null;
  amountSen: number | null;
  change: "add" | "deduct" | "change";
  /** The line's quantity after the VO; shown when the VO changes only the price. */
  lineQty?: number | null;
  goesTo: GoesTo;
  /** The catalog group and sub-category codes (null: none, or not read when the role sees every category). */
  categoryCode: string | null;
  subCode: string | null;
  fromItemCode: string | null;
  /** What a change to an existing line moved, in words ("Colour: White -> Grey", "Remark: ..."). */
  changes?: string[];
}

export interface VoRow {
  key: string;
  label: string;
  source: "amendment" | "renovation";
  no: string;
  soDocNo: string;
  title: string | null;
  status: string;
  statusLabel: string;
  bucket: VoBucket;
  date: string | null;
  raisedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** Recorded and applied at once, no approver (a sales order VO). */
  recorded?: boolean;
  netSen: number | null;
  href: string;
  lines: VoLine[];
}

export interface VoAnswer {
  so: { docNo: string; renovation: boolean } | null;
  finance: boolean;
  vos: VoRow[];
  counts: { pending: number; approved: number; closed: number };
  totals: { addedSen: number; deductedSen: number; netSen: number; pendingNetSen: number } | null;
  /** The caller's role sees only some product categories: VO lines of the others are left out by the server. */
  categoryRestricted: boolean;
}

export type GrState = "yes" | "part" | "no";

export interface PoLine {
  id: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  supplierName: string | null;
  categoryCode: string | null;
  categoryLabel: string;
  categorySort: number;
  subCode: string | null;
  subLabel: string;
  subSort: number;
  product: string;
  sku: string;
  uom: string;
  qty: number;
  area: string | null;
  poDate: string | null;
  deliveryDate: string | null;
  gr: GrState;
  delivered: boolean;
}

export interface PoAnswer {
  lines: PoLine[];
  counts: { pos: number; lines: number; received: number; delivered: number; cancelled: number };
  /** The caller's role sees only some product categories: lines of the others are left out by the server. */
  categoryRestricted: boolean;
}

export interface ClientItem {
  key: string;
  soDocNo?: string;
  soItemId?: string | null;
  itemCode: string | null;
  description: string;
  /** Not sent on the public client link, which has no role. */
  categoryCode?: string | null;
  subCode?: string | null;
  categoryLabel: string;
  categorySort?: number;
  subLabel: string;
  subSort?: number;
  area: string | null;
  qty: number;
  measure: string | null;
  uom: string | null;
  photoKeys?: string[];
  /** The SKU's catalog photos, primary first (staff answer only). */
  skuPhotos?: Array<{ productId: string; key: string; thumbKey: string | null }>;
  /** The client link's photos, by reference (public answer only). */
  photos?: Array<{ ref: string; from: "line" | "sku" }>;
  voNo?: string | null;
  pending: boolean;
  /** The PO tab's processing (buy by) and delivery dates of the line (absent from an older server). */
  orderOn?: string | null;
  deliverOn?: string | null;
}

export interface ClientAnswer {
  items: ClientItem[];
  /** The caller's role sees only some product categories: items of the others are left out by the server. */
  categoryRestricted: boolean;
}

export interface ClientPublicAnswer { company: string | null; project: string; expiresAt: string; items: ClientItem[] }

const B = "/api/beta";

export const voPoApi = {
  vo: (projectId: number): Promise<VoAnswer> => api.get<VoAnswer>(`${B}/projects/${projectId}/vo`),
  po: (projectId: number): Promise<PoAnswer> => api.get<PoAnswer>(`${B}/projects/${projectId}/po`),
  clientPo: (projectId: number): Promise<ClientAnswer> => api.get<ClientAnswer>(`${B}/projects/${projectId}/client-po`),
  clientLink: (projectId: number): Promise<{ token: string; expiresAt: string }> =>
    api.post<{ token: string; expiresAt: string }>(`${B}/projects/${projectId}/client-link`, {}),
};

/** A SKU catalog photo: served without login, so a plain <img> can show it (public-images.ts). */
export function skuPhotoPath(productId: string, key: string): string {
  return `/api/scm/mfg-products/${encodeURIComponent(productId)}/photo/${encodeURIComponent(key)}`;
}

/** One photo of the client's link, fetched through the link's own token. */
export function clientPhotoUrl(apiBase: string, token: string, ref: string, thumb: boolean): string {
  return `${apiBase}/api/public/beta-client/${encodeURIComponent(token)}/photos/${ref}${thumb ? "?thumb=1" : ""}`;
}

/** The client's page address for a link token (the engine screens site, as the other share links). */
export function clientLinkUrl(origin: string, token: string): string {
  return `${origin}/cpo/${token}`;
}

/* ---------- grouping ---------- */

export interface Group<T> { key: string; label: string; items: T[] }
export interface CategoryGroup<T> extends Group<T> { subs: Array<Group<T>>; count: number }

/** Category, then sub-category, in the catalog's order; lines keep their order inside a sub-category. */
export function byCategory<T extends { categoryLabel: string; categorySort?: number; subLabel: string; subSort?: number }>(items: readonly T[]): Array<CategoryGroup<T>> {
  const cats = new Map<string, { sort: number; subs: Map<string, { sort: number; items: T[] }> }>();
  for (const i of items) {
    const c = cats.get(i.categoryLabel) ?? { sort: i.categorySort ?? 999, subs: new Map() };
    const s = c.subs.get(i.subLabel) ?? { sort: i.subSort ?? 999, items: [] };
    s.items.push(i);
    c.subs.set(i.subLabel, s);
    cats.set(i.categoryLabel, c);
  }
  return [...cats.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
    .map(([label, c]) => {
      const subs = [...c.subs.entries()]
        .sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))
        .map(([sl, s]) => ({ key: `${label}/${sl}`, label: sl, items: s.items }));
      return { key: label, label, items: subs.flatMap((s) => s.items), subs, count: subs.reduce((n, s) => n + s.items.length, 0) };
    });
}

/** By area (room); lines with no area last, as "No area". */
export function byArea<T extends { area: string | null }>(items: readonly T[]): Array<Group<T>> {
  const m = new Map<string, T[]>();
  for (const i of items) {
    const k = i.area?.trim() || "";
    m.set(k, [...(m.get(k) ?? []), i]);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
    .map(([k, items]) => ({ key: k || "-", label: k || "No area", items }));
}

/** The quantity a VO line moves, signed: "+2", "-1", "+12.5 sqft". */
export function signedQty(l: Pick<VoLine, "qty" | "measure" | "change"> & { lineQty?: number | null }): string {
  if (l.measure) return `${l.change === "deduct" ? "-" : "+"}${l.measure}`;
  /* A price-only change moves no quantity: show the line's quantity, the amount column carries the change. */
  if (l.qty === 0) return l.lineQty != null && l.lineQty !== 0 ? String(l.lineQty) : "0";
  return l.qty > 0 ? `+${l.qty}` : String(l.qty);
}
