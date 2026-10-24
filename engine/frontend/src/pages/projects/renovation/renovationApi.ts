/* Wire types and calls for the renovation project screens (/api/renovation,
   /api/scm/site-receipts). Shapes mirror engine/backend/src/routes/renovation.ts. */

import { toUploadableImage } from "../../../lib/heicToJpeg";
import { api } from "../../../api/client";
import type { StageKey } from "../../../vendor/shared/renovation-stages";

export type SupplyCondition = "none" | "pending_purchased" | "pending_arrived" | "all_arrived";
export type UnitKeyStatus = "not_collected" | "collected" | "returned" | "unknown";
export type StageState = "not_started" | "in_progress" | "done" | "skipped";
export type TaskStatus = "skipped" | "done" | "in_progress" | "overdue" | "late_start" | "planned" | "unscheduled";

export interface RedFlag { code: string; text: string; count?: number }

export interface PaymentSummary {
  condition: string;
  label: string;
  count?: number;
  billedCount?: number;
  receivedCount?: number;
  billedSen?: number;
  receivedSen?: number;
  contractSen?: number | null;
}

export interface BoardRow {
  id: number;
  code: string | null;
  name: string;
  building: string | null;
  unitNo: string | null;
  customerName: string | null;
  customerKind: string | null;
  typeName: string | null;
  soDocNo: string | null;
  soDate: string | null;
  salesperson: string | null;
  soStatus: string | null;
  furnitureCondition: SupplyCondition | null;
  renoItemCondition: SupplyCondition | null;
  renoCondition: StageKey;
  renoConditionLabel: string;
  payment: PaymentSummary;
  unitKey: UnitKeyStatus;
  gateOpen: boolean;
  redFlags: RedFlag[];
  plannedHandoverDate: string | null;
  linesUnavailable: string | null;
  archived: boolean;
}

export interface PodCoverage { total: number; covered: number; missing: string[] }

export interface StageView {
  key: StageKey;
  label: string;
  seq: number;
  inType: boolean;
  state: StageState;
  skipSource: "manual" | "type" | "auto" | null;
  skipReason: string | null;
  skippedBy: number | null;
  skippedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  skippable: boolean;
  ownedLineIds: string[];
  pod: PodCoverage;
  tasks: number;
}

export interface ChecklistItem {
  id: number;
  section_id: number | null;
  stage_key: string | null;
  seq: number;
  title: string;
  status: string;
  item_key: string | null;
  evidence_hint: string | null;
  skippable: boolean;
  skip_reason: string | null;
  skipped_at: string | null;
  completed_at: string | null;
}

export interface TaskView {
  id: number;
  stage_key: string;
  trade_code: string;
  fix_phase: string;
  label: string;
  seq: number;
  fulfilment_kind: "po" | "internal";
  supplier_id: string | null;
  supplier_name: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  state: string;
  skip_reason: string | null;
  skip_source: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  status: TaskStatus;
  poFullyReceived: boolean | null;
}

export interface Prompt {
  instalmentId: string;
  seq: number;
  label: string;
  description: string | null;
  stage: StageKey | null;
  trigger: string;
  dueSen: number | null;
  actionable: boolean;
}

export interface ProjectDetail {
  project: {
    id: number; code: string | null; name: string; customer_name: string | null; customer_phone: string | null; customer_email?: string | null; layout_label?: string | null; customer_kind: string | null;
    /** Conts (finance phase 1.5): RENOVATION / INHOUSE_RENOVATION, or null to follow the quotation's brand. */
    finance_kind?: string | null;
    building: string | null; unit_no: string | null; site_address: string | null; planned_handover_date: string | null;
    handed_over_at: string | null; salesperson_name: string | null; notes: string | null;
  };
  type: { id: number; name: string; stage_keys: string[] } | null;
  so: { doc_no: string; status: string; so_date: string | null; agent: string | null } | null;
  /** The first confirmed sales order linked to the project, of any kind: the signed contract. */
  signedSo?: { doc_no: string; status: string; so_date: string | null } | null;
  linesUnavailable: string | null;
  lines: Array<{ soItemId: string; group: string | null; subCategory: string | null; qty: number; room: string | null; description: string | null; itemCode: string | null }> | null;
  stages: StageView[];
  currentStage: StageKey;
  gate: { open: boolean; reasons: string[]; messages: string[] };
  billing: { available: boolean; hidden?: boolean; unavailableReason?: string };
  prompts: Prompt[];
  payment: PaymentSummary;
  conditions: { furniture: { condition: SupplyCondition } | null; renoItem: { condition: SupplyCondition } | null };
  unitKey: UnitKeyStatus;
  redFlags: RedFlag[];
  checklist: ChecklistItem[];
  tasks: TaskView[];
  handover: { customer_signer_name: string; signed_at: string } | null;
  defects: Array<{ id: number; phase: string; location: string | null; item_description: string | null; due_date: string | null; closed_at: string | null; photo_r2_key: string | null }>;
  serviceCases: Array<{ id: number; assr_no: string; status: string | null; complaint_issue: string | null; created_at: string | null }>;
  purchaseOrders: Array<{ id: string; po_number: string; supplier_name: string | null; status: string; lines: number; received: boolean }>;
  receipts: Array<{ id: string; grn_number: string; status: string; site_received_at: string | null; received_at_site: boolean; po_number: string | null; supplier_name: string | null }>;
  financeHidden: boolean;
}

export interface PodPhoto { id: string; kind: string; location: string | null; r2_key: string; caption?: string | null; grn_number?: string | null; grn_id?: string | null }
export interface PodView { rooms: Array<{ room: string; photos: PodPhoto[] }>; receipts: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown>> }

export interface CalendarTask {
  id: number;
  project_id: number;
  project_code: string | null;
  project_name: string;
  building: string | null;
  unit_no: string | null;
  stage_key: string;
  trade_code: string;
  label: string;
  fulfilment_kind: string;
  state: string;
  supplier_id: string | null;
  supplier_name: string | null;
  po_number: string | null;
  planned_start: string | null;
  planned_end: string | null;
  status: TaskStatus;
  /** in-house crew from the people list (migration 0084) */
  assignees?: Array<{ id: number; name: string }>;
}

export interface ProjectType { id: number; slug: string; name: string; stage_keys: string[]; active: boolean; sort_order: number }

export interface OpenLine {
  po_item_id: string;
  po_number: string;
  supplier_name: string | null;
  item_code: string;
  material_name: string;
  description: string | null;
  remaining: number;
  room: string | null;
  group: string | null;
}

const R = "/api/renovation";

export const renovationApi = {
  mode: () => api.get<{ mode: "renovation" | "exhibition" }>(`${R}/mode`),
  board: () => api.get<{ data: BoardRow[] }>(R),
  types: () => api.get<{ data: ProjectType[]; stages: Array<{ key: StageKey; label: string }> }>(`${R}/types`),
  createType: (b: { name: string; stageKeys: string[] }) => api.post<{ id: number }>(`${R}/types`, b),
  patchType: (id: number, b: { name?: string; stageKeys?: string[]; active?: boolean }) => api.patch<{ ok: true }>(`${R}/types/${id}`, b),
  create: (b: Record<string, unknown>) => api.post<{ id: number; code: string }>(R, b),
  detail: (id: number) => api.get<ProjectDetail>(`${R}/${id}`),
  pod: (id: number) => api.get<PodView>(`${R}/${id}/pod`),
  startStage: (id: number, key: string) => api.post<{ ok: true }>(`${R}/${id}/stages/${key}/start`),
  completeStage: (id: number, key: string) => api.post<{ ok: true }>(`${R}/${id}/stages/${key}/complete`),
  skipStage: (id: number, key: string, reason: string) => api.post<{ ok: true }>(`${R}/${id}/stages/${key}/skip`, { reason }),
  unskipStage: (id: number, key: string) => api.post<{ ok: true }>(`${R}/${id}/stages/${key}/unskip`),
  planStage: (id: number, key: string, plannedStart: string | null, plannedEnd: string | null) =>
    api.patch<{ ok: true }>(`${R}/${id}/stages/${key}`, { plannedStart, plannedEnd }),
  tickItem: (itemId: number, done: boolean) => api.post<{ ok: true }>(`/api/projects/checklist/${itemId}/status`, { status: done ? "done" : "pending" }),
  skipItem: (itemId: number, reason: string) => api.post<{ ok: true }>(`${R}/checklist/${itemId}/skip`, { reason }),
  unskipItem: (itemId: number) => api.post<{ ok: true }>(`${R}/checklist/${itemId}/unskip`),
  syncTasks: (id: number) => api.post<{ created: number; refreshed: number; skipped: number; reopened: number }>(`${R}/${id}/trade-tasks/sync`),
  planTask: (taskId: number, plannedStart: string | null, plannedEnd: string | null) =>
    api.patch<{ ok: true }>(`${R}/trade-tasks/${taskId}`, { plannedStart, plannedEnd }),
  startTask: (taskId: number) => api.post<{ ok: true }>(`${R}/trade-tasks/${taskId}/start`),
  completeTask: (taskId: number, note?: string) => api.post<{ ok: true }>(`${R}/trade-tasks/${taskId}/complete`, note ? { note } : {}),
  skipTask: (taskId: number, reason: string) => api.post<{ ok: true }>(`${R}/trade-tasks/${taskId}/skip`, { reason }),
  unskipTask: (taskId: number) => api.post<{ ok: true }>(`${R}/trade-tasks/${taskId}/unskip`),
  calendar: (q: { from: string; to: string; supplierId?: string; projectId?: number; personId?: number }) => {
    const p = new URLSearchParams({ from: q.from, to: q.to });
    if (q.supplierId) p.set("supplierId", q.supplierId);
    if (q.personId) p.set("personId", String(q.personId));
    if (q.projectId) p.set("projectId", String(q.projectId));
    return api.get<{ data: CalendarTask[]; contractors: Array<{ id: string; name: string }>; crew?: Array<{ id: number; name: string }> }>(`${R}/calendar?${p.toString()}`);
  },
  addSnag: (id: number, b: { location?: string; description: string; photoR2Key?: string | null }) => api.post<{ id: number }>(`${R}/${id}/snags`, b),
  closeSnag: (defectId: number) => api.post<{ ok: true }>(`${R}/snags/${defectId}/close`),
  handover: (id: number, b: Record<string, unknown>) => api.post<{ ok: true }>(`${R}/${id}/handover`, b),
  /* The server takes JPEG / PNG / WebP / PDF only: an iPhone HEIC file is converted to JPEG first
     (throws HeicConversionError, with a message for the screen, when it cannot be). */
  upload: async (id: number, kind: string, blob: Blob) => {
    const body = blob instanceof File ? await toUploadableImage(blob) : blob;
    return api.postBinary<{ key: string }>(`${R}/${id}/files?kind=${encodeURIComponent(kind)}`, body, body.type || "image/jpeg");
  },
  fileUrl: (id: number, key: string) => `${R}/${id}/files?key=${encodeURIComponent(key)}`,
  bill: (docNo: string, instalmentId: string, expectedAmountSen: number | null, invoiceDate: string) =>
    api.post<unknown>(`/api/scm/renovation/sales-orders/${encodeURIComponent(docNo)}/instalments/${encodeURIComponent(instalmentId)}/bill`, { invoiceDate, expectedAmountSen }),
  openLines: (projectId: number) => api.get<{ data: OpenLine[] }>(`/api/scm/site-receipts/projects/${projectId}/open-lines`),
  siteReceipt: (b: Record<string, unknown>, idempotencyKey: string) => api.post<{ created: Array<{ id: string; grnNumber: string; posted: boolean; postError?: string }>; tasksCompleted: number }>(`/api/scm/site-receipts`, b, { idempotencyKey }),
  siteReceiptDetail: (grnId: string) => api.get<{ receipt: Record<string, unknown>; photos: PodPhoto[]; lines: Array<{ id: string; item_code: string; material_name: string; qty_accepted: number }> }>(`/api/scm/site-receipts/${grnId}`),
};
