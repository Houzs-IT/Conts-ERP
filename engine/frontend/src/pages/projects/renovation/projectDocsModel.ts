/* A renovation project's transaction documents (owner, 14 Oct 2026, "batch 4"; migration 0116), as read from
   GET /api/renovation/:id/documents (engine/backend/src/services/renovation/documents.ts). Pure: which POs sit under
   which procurement row, the row's actual dates and count, and whether it is late. */

export interface ProjectPo {
  id: string; poNumber: string; status: string; poDate: string | null; expectedAt: string | null; totalSen: number;
  supplierName: string | null; categoryGroup: string | null; subCategory: string | null;
  orderedQty: number; receivedQty: number; receipt: "none" | "partial" | "full";
}
export interface ProjectGr { id: string; grnNumber: string; receivedAt: string | null; status: string; totalSen: number; poIds: string[]; atSite: boolean }
export interface ProjectDocRow { id: string; no: string; date: string | null; status: string; amountSen: number | null }
export interface ProjectDo extends ProjectDocRow { soDocNo: string | null; deliveredAt: string | null; podR2Key: string | null; signed: boolean }
export interface ProjectSi extends ProjectDocRow { soDocNo: string | null; deliveryOrderId: string | null }
export interface ProjectReturn extends ProjectDocRow { parentId: string | null }
export interface ProjectDocuments {
  ready: boolean;
  projectId: number;
  quotations?: ProjectDocRow[];
  salesOrders?: Array<ProjectDocRow & { kind: string }>;
  purchaseOrders?: ProjectPo[];
  goodsReceipts?: ProjectGr[];
  deliveryOrders?: ProjectDo[];
  salesInvoices?: ProjectSi[];
  deliveryReturns?: ProjectReturn[];
  purchaseReturns?: ProjectReturn[];
}

/** A sales order's delivery orders and invoices (an invoice made from a DO of the SO counts too). */
export function soChildren(d: ProjectDocuments, soDocNo: string): { dos: ProjectDo[]; sis: ProjectSi[] } {
  const dos = (d.deliveryOrders ?? []).filter((x) => x.soDocNo === soDocNo);
  const doIds = new Set(dos.map((x) => x.id));
  const sis = (d.salesInvoices ?? []).filter((x) => x.soDocNo === soDocNo || (x.deliveryOrderId != null && doIds.has(x.deliveryOrderId)));
  return { dos, sis };
}

const live = (po: ProjectPo) => po.status !== "CANCELLED";

/** POs of one procurement row: a category row takes the category's POs whose sub-category has no row of its own. */
export function posForRow(pos: readonly ProjectPo[], group: string, sub: string | null, subCodes: readonly string[]): ProjectPo[] {
  return pos.filter((p) => p.categoryGroup === group && (sub === null ? !p.subCategory || !subCodes.includes(p.subCategory) : p.subCategory === sub));
}

export interface RowSummary {
  count: number;
  received: number;
  /** Earliest PO date and latest expected delivery of the row's live POs. */
  actualPoDate: string | null;
  actualDelivery: string | null;
  late: boolean;
}

/** "Late" = the planned delivery date has passed and the row's goods are not all received (or not even ordered). */
export function rowSummary(pos: readonly ProjectPo[], plannedDelivery: string | null, today: string): RowSummary {
  const l = pos.filter(live);
  const dates = l.map((p) => p.poDate).filter((d): d is string => !!d).sort();
  const dels = l.map((p) => p.expectedAt).filter((d): d is string => !!d).sort();
  const received = l.filter((p) => p.receipt === "full").length;
  const allIn = l.length > 0 && received === l.length;
  return {
    count: l.length,
    received,
    actualPoDate: dates[0] ?? null,
    actualDelivery: dels[dels.length - 1] ?? null,
    late: !!plannedDelivery && plannedDelivery < today && !allIn,
  };
}

/** "3 PO · 2 received", '' when the row has none. */
export function countLabel(s: Pick<RowSummary, "count" | "received">): string {
  if (s.count === 0) return "";
  return `${s.count} PO · ${s.received} received`;
}

export function grsForPo(grs: readonly ProjectGr[], poId: string): ProjectGr[] {
  return grs.filter((g) => g.poIds.includes(poId));
}

/** Today in Kuala Lumpur, YYYY-MM-DD. */
export function todayKl(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
