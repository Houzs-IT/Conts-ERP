/* A renovation project's transaction documents (owner, 14 Oct 2026, "batch 4"; migration 0116), as read from
   GET /api/renovation/:id/documents (engine/backend/src/services/renovation/documents.ts). Types only, plus today's
   date in Kuala Lumpur; Procurement details counts goods with procurementStatusModel.ts. */

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

/** Today in Kuala Lumpur, YYYY-MM-DD. */
export function todayKl(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
