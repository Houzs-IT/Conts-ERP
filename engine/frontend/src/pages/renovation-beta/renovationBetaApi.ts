/* Calls for the Beta project workspace, bundle A (docs/superpowers/plans/2026-10-23-beta-project-workspace.md,
   section 9). Shapes mirror engine/backend/src/routes/renovationBeta.ts. */

import { api } from "../../api/client";
import type { DesignFile, DesignNote, SiteMeasure } from "../projects/renovation/simpleApi";

export const BETA_TRADES = ["carpenter", "electrician", "plumber", "painter", "plaster", "hacking", "aircon", "tiler", "other"] as const;
export type BetaTrade = (typeof BETA_TRADES)[number];

export const REMINDER_KINDS = ["client_approval", "client_answer", "defect", "payment"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface BetaReview {
  fileId: number;
  sentOn: string | null;
  dueOn: string | null;
  approvedOn: string | null;
  approvedByName: string | null;
  approvalNote: string | null;
}

export interface BetaDefect {
  id: number;
  phase: string;
  location: string | null;
  description: string | null;
  trade: string | null;
  dueDate: string | null;
  reportedAt: string | null;
  reportedByName: string | null;
  photoKey: string | null;
  afterPhotoKey: string | null;
  fixedAt: string | null;
  closedAt: string | null;
  redoCount: number;
}

export interface BetaInstalment {
  seq: number;
  label: string;
  amountSen: number;
  paidSen: number;
  status: "paid" | "billed" | "not_billed";
  stageCode: string | null;
  trigger: string;
}

export type BetaPayments =
  | { state: "hidden" }
  | { state: "none" }
  | { state: "ok"; contractSen: number; receivedSen: number; instalments: BetaInstalment[] };

export interface BetaSettings { design3dDays: number; design2dDays: number }

export interface BetaWorkspace {
  settings: BetaSettings;
  reviews: BetaReview[];
  defects: BetaDefect[];
  payments: BetaPayments;
}

/** The design records the Overview, Drawings and Site tabs share (GET /design-records). */
export interface DesignRecords { measures: SiteMeasure[]; files: DesignFile[]; notes: DesignNote[] }

export interface NewDefect { location: string | null; description: string; trade: BetaTrade | null; dueDate: string | null; photoKey: string }

const B = "/api/beta";

export const betaApi = {
  workspace: (projectId: number) => api.get<BetaWorkspace>(`${B}/projects/${projectId}/workspace`),
  saveSettings: (b: BetaSettings) => api.put<{ ok: true }>(`${B}/settings`, b),
  reportDefect: (projectId: number, b: NewDefect) => api.post<{ id: number }>(`${B}/projects/${projectId}/defects`, b),
  defectFixed: (defectId: number, afterPhotoKey: string | null) =>
    api.post<{ ok: true }>(`${B}/defects/${defectId}/fixed`, afterPhotoKey ? { afterPhotoKey } : {}),
  defectRedo: (defectId: number, note: string | null) => api.post<{ ok: true }>(`${B}/defects/${defectId}/redo`, note ? { note } : {}),
  defectClose: (defectId: number) => api.post<{ ok: true }>(`${B}/defects/${defectId}/close`, {}),
  designSent: (fileId: number, b: { sentOn: string; dueOn: string }) => api.post<{ ok: true }>(`${B}/design-files/${fileId}/sent`, b),
  designApproval: (fileId: number, b: { approvedOn: string; approvedByName: string; note?: string }) =>
    api.post<{ ok: true }>(`${B}/design-files/${fileId}/approval`, b),
  removeApproval: (fileId: number) => api.del<{ ok: true }>(`${B}/design-files/${fileId}/approval`),
  remind: (projectId: number, b: { kind: ReminderKind; text: string }) => api.post<{ ok: true }>(`${B}/projects/${projectId}/reminders`, b),
};
