/* Calls for handover checklists, the checks walked from them and the defect queue (TODO item 17, migration 0296).
   Shapes mirror engine/backend/src/routes/renovationBetaHandover.ts. Before 0296 is applied the reads answer
   ready: false. */

import { api } from "../../api/client";

export interface TemplateItem { id?: number; area: string | null; item: string; criteria: string | null }
export interface HandoverTemplate { id: number; name: string; active: boolean; updatedAt: string | null; items: TemplateItem[] }

export type CheckResult = "pass" | "fail" | "na";
export type DefectState = "open" | "fixed" | "closed";

export interface CheckItem {
  id: number;
  area: string | null;
  item: string;
  criteria: string | null;
  result: CheckResult | null;
  note: string | null;
  defectId: number | null;
  defectState: DefectState | null;
  checkedAt: string | null;
  checkedByName: string | null;
}

export interface CheckProgress { total: number; checked: number; passed: number; failed: number; na: number; open: number }

export interface HandoverCheck {
  id: number;
  templateName: string;
  startedAt: string | null;
  startedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  progress: CheckProgress;
  items: CheckItem[];
}

export interface QueueDefect {
  id: number;
  projectId: number;
  projectCode: string | null;
  projectName: string | null;
  customerName: string | null;
  location: string | null;
  description: string | null;
  trade: string | null;
  dueDate: string | null;
  reportedAt: string | null;
  fixedAt: string | null;
  redoCount: number;
  assigneeId: number | null;
  assigneeName: string | null;
  assigneePhone: string | null;
  photoKey: string | null;
}

export interface QueueCheck {
  id: number;
  projectId: number;
  projectCode: string | null;
  projectName: string | null;
  templateName: string;
  startedAt: string | null;
  startedByName: string | null;
  total: number;
  checked: number;
  failed: number;
}

export interface DefectQueue { checksReady: boolean; defects: QueueDefect[]; checks: QueueCheck[] }

export type Ready<T> = ({ ready: true } & T) | { ready: false };

export interface TemplateBody { name: string; active?: boolean; items: TemplateItem[] }

const B = "/api/beta";

export const handoverApi = {
  templates: (all = false): Promise<Ready<{ templates: HandoverTemplate[] }>> =>
    api.get<Ready<{ templates: HandoverTemplate[] }>>(`${B}/handover-templates${all ? "?all=1" : ""}`),
  createTemplate: (b: TemplateBody): Promise<{ id: number }> => api.post<{ id: number }>(`${B}/handover-templates`, b),
  saveTemplate: (id: number, b: TemplateBody): Promise<{ ok: true }> => api.put<{ ok: true }>(`${B}/handover-templates/${id}`, b),
  checks: (projectId: number): Promise<Ready<{ checks: HandoverCheck[] }>> =>
    api.get<Ready<{ checks: HandoverCheck[] }>>(`${B}/projects/${projectId}/handover-checks`),
  start: (projectId: number, templateId: number): Promise<{ id: number }> => api.post<{ id: number }>(`${B}/projects/${projectId}/handover-checks`, { templateId }),
  mark: (itemId: number, result: "pass" | "na" | null, note: string | null): Promise<{ ok: true }> =>
    api.post<{ ok: true }>(`${B}/handover-check-items/${itemId}`, { result, note }),
  finish: (checkId: number): Promise<{ ok: true }> => api.post<{ ok: true }>(`${B}/handover-checks/${checkId}/finish`),
  reopen: (checkId: number): Promise<{ ok: true }> => api.post<{ ok: true }>(`${B}/handover-checks/${checkId}/reopen`),
  remove: (checkId: number): Promise<{ ok: true }> => api.post<{ ok: true }>(`${B}/handover-checks/${checkId}/remove`),
  queue: (): Promise<DefectQueue> => api.get<DefectQueue>(`${B}/defect-queue`),
};
