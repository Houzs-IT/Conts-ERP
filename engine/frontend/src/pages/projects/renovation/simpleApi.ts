/* Wire types and calls for the simplified renovation project (owner decisions
   11 Oct 2026). Shapes mirror engine/backend/src/routes/renovationProject.ts and
   the additions to GET /api/renovation/:id. */

import { api } from "../../../api/client";
import type { ProjectDetail, SupplyCondition, TaskView } from "./renovationApi";
import type { FlowStepKey, HoldFlag, PersonRole } from "../../../vendor/shared/renovation-stages";

export type { FlowStepKey, HoldFlag, PersonRole };

export interface FlowView {
  current: FlowStepKey;
  currentLabel: string;
  currentIndex: number;
  derived: FlowStepKey;
  manualStep: FlowStepKey | null;
  manualInEffect: boolean;
  steps: Array<{ key: FlowStepKey; label: string }>;
}

export interface Hold { flag: HoldFlag; note: string | null; at: string | null }
export interface Money { contractSen: number | null; receivedSen: number | null; receivedPct: number | null }
export interface KeyHolder { personId: number | null; name: string | null; movedOn: string }
export interface PersonRef { id: number | null; name: string | null }
export interface Assignee { id: number; name: string }
export interface AttendingPerson { id: number; name: string; active: boolean; phone: string | null }

export type TaskViewV2 = TaskView & { category_code?: string | null; occurrence?: number; assignees?: Assignee[]; actual_start: string | null };

export interface ProjectDetailV2 extends Omit<ProjectDetail, "tasks"> {
  flow: FlowView;
  hold: Hold | null;
  money: Money;
  keyHolder: KeyHolder | null;
  vo: { count: number; approved: number } | null;
  people: { sales: PersonRef; designer: PersonRef; renoPic: PersonRef; pic: PersonRef; attending: AttendingPerson[] };
  tasks: TaskViewV2[];
}

export interface BoardRowV2 {
  id: number;
  code: string | null;
  name: string;
  building: string | null;
  unitNo: string | null;
  customerName: string | null;
  soDocNo: string | null;
  soDate: string | null;
  sales: { personId: number | null; name: string | null };
  contractSen: number | null;
  receivedSen: number | null;
  receivedPct: number | null;
  moneyHidden: boolean;
  step: { key: FlowStepKey; label: string; index: number; count: number; manual: boolean };
  hold: { flag: HoldFlag; label: string; note: string | null } | null;
  statusText: string;
  furnitureArrival: SupplyCondition | null;
  renoItemArrival: SupplyCondition | null;
  keyHolder: KeyHolder | null;
  vo: { has: boolean; count: number; approved: number } | null;
  handoverDate: string | null;
  plannedHandoverDate: string | null;
  redFlagCount: number;
  archived: boolean;
}

export interface Person {
  id: number;
  name: string;
  roles: PersonRole[];
  active: boolean;
  user_id: number | null;
  phone: string | null;
  notes: string | null;
  source: string;
}

export interface FlowStepRow { step_key: FlowStepKey; label: string; sort_order: number; active: boolean }
export interface TaskCategoryRow { code: string; label: string; stage_key: string; trade_code: string | null; internal_key: string | null; sort_order: number; active: boolean; notion: boolean }

export interface StepInfo extends FlowView {
  projectId: number;
  manual: { step: FlowStepKey; reason: string | null; at: string | null; inEffect: boolean } | null;
  hold: Hold | null;
  history: Array<{ id: number; kind: string; from_value: string | null; to_value: string | null; reason: string | null; user_name: string | null; at: string }>;
}

export interface KeyMove { id: number; project_id: number; moved_on: string; from_person_name: string | null; to_person_name: string | null; note: string | null; recorded_by_name: string | null }
export interface SiteMeasure { id: number; done_on: string | null; person_name: string | null; note: string | null }
export interface DesignFile {
  id: number; kind: "2d" | "3d" | "other"; version: number; file_name: string; r2_key: string | null; external_url: string | null;
  person_name: string | null; uploaded_by_name: string | null; uploaded_at: string; note: string | null;
  submitted_on: string | null; next_person_id: number | null; next_person_name: string | null;
}
export interface DesignNote {
  id: number; kind: "3d" | "2d"; noted_on: string; requested_by_person_id: number | null; requested_by_person_name: string | null;
  requested_by_text: string | null; note: string; created_by_name: string | null;
}
export type ProcMode = "follow" | "own" | "none";
export interface ProcDates { poDate: string | null; deliveryDate: string | null }
export interface ProcSub { code: string; label: string; mode: ProcMode; stored: ProcDates; effective: ProcDates; updatedAt: string | null; updatedBy: string | null }
export interface ProcGroup extends ProcDates { code: string; label: string; updatedAt: string | null; updatedBy: string | null; subs: ProcSub[] }
export interface LinkableSo { doc_no: string; so_date: string | null; debtor_name: string | null; status: string; local_total_sen: number | null; building: string | null; unit_no: string | null }

const R = "/api/renovation";

export const simpleApi = {
  boardRows: () => api.get<{ data: BoardRowV2[] }>(`${R}/board-rows`),
  detail: (id: number) => api.get<ProjectDetailV2>(`${R}/${id}`),
  people: (q: { role?: PersonRole; active?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.role) p.set("role", q.role);
    if (q.active !== undefined) p.set("active", q.active ? "1" : "0");
    const qs = p.toString();
    return api.get<{ data: Person[] }>(`${R}/people${qs ? `?${qs}` : ""}`);
  },
  createPerson: (b: { name: string; roles: PersonRole[]; phone?: string | null; notes?: string | null }) => api.post<{ id: number }>(`${R}/people`, b),
  patchPerson: (id: number, b: Partial<{ name: string; roles: PersonRole[]; active: boolean; phone: string | null; notes: string | null }>) =>
    api.patch<{ ok: true }>(`${R}/people/${id}`, b),
  flowSteps: () => api.get<{ data: FlowStepRow[] }>(`${R}/flow-steps`),
  patchFlowStep: (key: FlowStepKey, b: Partial<{ label: string; sortOrder: number; active: boolean }>) => api.patch<{ ok: true }>(`${R}/flow-steps/${key}`, b),
  taskCategories: () => api.get<{ data: TaskCategoryRow[] }>(`${R}/task-categories`),
  patchTaskCategory: (code: string, b: Partial<{ label: string; sortOrder: number; active: boolean }>) => api.patch<{ ok: true }>(`${R}/task-categories/${code}`, b),
  step: (id: number) => api.get<StepInfo>(`${R}/${id}/step`),
  setStep: (id: number, step: FlowStepKey, reason: string | null) => api.post<{ ok: true }>(`${R}/${id}/step`, { step, reason }),
  followData: (id: number) => api.post<{ ok: true }>(`${R}/${id}/step/follow-data`, {}),
  setHold: (id: number, flag: HoldFlag, note: string | null) => api.post<{ ok: true }>(`${R}/${id}/hold`, { flag, note }),
  clearHold: (id: number) => api.post<{ ok: true }>(`${R}/${id}/hold/clear`, {}),
  setPeople: (id: number, b: Partial<{ salesPersonId: number | null; designerPersonId: number | null; renoPicPersonId: number | null; picPersonId: number | null; attendingPersonIds: number[] }>) =>
    api.patch<{ ok: true }>(`${R}/${id}/people`, b),
  keyLog: (projectId: number) => api.get<{ data: KeyMove[] }>(`${R}/key-log?projectId=${projectId}`),
  addKeyMove: (id: number, b: { movedOn: string; fromPersonId: number | null; toPersonId: number | null; note?: string | null }) =>
    api.post<{ id: number }>(`${R}/${id}/key-moves`, b),
  designRecords: (projectId: number) => api.get<{ measures: SiteMeasure[]; files: DesignFile[]; notes: DesignNote[] }>(`${R}/design-records?projectId=${projectId}`),
  addSiteMeasure: (id: number, b: { doneOn: string; personId: number | null; note?: string | null }) => api.post<{ id: number }>(`${R}/${id}/site-measures`, b),
  uploadDesignFile: (id: number, kind: "2d" | "3d" | "other", file: File, personId: number | null, note: string | null, extra: { submittedOn?: string; nextPersonId?: number | null } = {}) => {
    const p = new URLSearchParams({ kind, fileName: file.name });
    if (personId) p.set("personId", String(personId));
    if (extra.submittedOn) p.set("submittedOn", extra.submittedOn);
    if (extra.nextPersonId) p.set("nextPersonId", String(extra.nextPersonId));
    if (note) p.set("note", note);
    return api.postBinary<{ id: number; version: number }>(`${R}/${id}/design-files?${p.toString()}`, file, file.type || "application/octet-stream");
  },
  addDesignLink: (id: number, b: { kind: "2d" | "3d"; url: string; submittedOn: string; personId: number | null; nextPersonId?: number | null; note?: string | null }) =>
    api.post<{ id: number; version: number }>(`${R}/${id}/design-links`, b),
  addDesignNote: (id: number, b: { kind: "2d" | "3d"; notedOn: string; requestedByPersonId: number | null; requestedByText: string | null; note: string }) =>
    api.post<{ id: number }>(`${R}/${id}/design-notes`, b),
  procurement: (id: number) => api.get<{ projectId: number; groups: ProcGroup[] }>(`${R}/${id}/procurement`),
  setCategoryDates: (id: number, group: string, b: ProcDates) =>
    api.put<{ ok: true; groups: ProcGroup[] }>(`${R}/${id}/procurement/${encodeURIComponent(group)}`, b),
  setSubDates: (id: number, group: string, sub: string, b: { mode: ProcMode } & Partial<ProcDates>) =>
    api.put<{ ok: true; groups: ProcGroup[] }>(`${R}/${id}/procurement/${encodeURIComponent(group)}/${encodeURIComponent(sub)}`, b),
  fileUrl: (id: number, key: string) => `${R}/${id}/files?key=${encodeURIComponent(key)}`,
  linkableSos: (q: string) => api.get<{ data: LinkableSo[] }>(`${R}/linkable-sos?q=${encodeURIComponent(q)}`),
  linkSo: (projectId: number, docNo: string) => api.post<{ ok: true }>(`${R}/link-so`, { projectId, docNo }),
  unlinkSo: (projectId: number) => api.post<{ ok: true }>(`${R}/${projectId}/unlink-so`, {}),
  projectFromSo: (b: { docNo: string; projectTypeId: number; name?: string | null }) => api.post<{ id: number; code: string }>(`${R}/from-so`, b),
  addTask: (id: number, b: { categoryCode: string; fulfilment: "po" | "internal"; assigneeIds: number[]; plannedStart?: string | null; plannedEnd?: string | null }) =>
    api.post<{ id: number }>(`${R}/${id}/tasks`, b),
  setAssignees: (taskId: number, personIds: number[]) => api.put<{ ok: true }>(`${R}/trade-tasks/${taskId}/assignees`, { personIds }),
  setFulfilment: (taskId: number, kind: "inhouse" | "po") => api.post<{ ok: true }>(`${R}/trade-tasks/${taskId}/fulfilment`, { kind }),
};
