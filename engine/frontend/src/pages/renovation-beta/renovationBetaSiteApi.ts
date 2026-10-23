/* Calls for Site & photos, Defects as repair tickets and the Beta Timeline (BRIEF-beta-oct24 sections 5 to 8).
   Shapes mirror the routes at the end of engine/backend/src/routes/renovationBeta.ts. */

import { api } from "../../api/client";
import type { TimelineEntry } from "../projects/renovation/renovationTimelineModel";
import type { BetaTrade } from "./renovationBetaApi";

export type DeliveryType = "delivery_order" | "goods_received";

export interface SitePhoto {
  id: string;
  /** API path that streams the photo or file. */
  path: string;
  name: string;
  image: boolean;
  area: string | null;
  at: string | null;
  source: "pod" | "site" | "upload";
}

export interface SiteDelivery {
  type: DeliveryType;
  id: string;
  no: string;
  at: string | null;
  status: string;
  from: string | null;
  poNumber: string | null;
  poIds: string[];
  areas: string[];
  photos: SitePhoto[];
}

export interface SiteView { ready: boolean; areas: string[]; deliveries: SiteDelivery[] }

export interface DefectTicket {
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
  fixedByName: string | null;
  closedAt: string | null;
  closedByName: string | null;
  redoCount: number;
  assigneeId: number | null;
  assigneeName: string | null;
  assigneePhone: string | null;
  lastRedoNote: string | null;
}

export interface DefectPatch {
  assigneePersonId?: number | null;
  trade?: BetaTrade | null;
  dueDate?: string | null;
  location?: string | null;
  description?: string;
}

export interface NewTicket {
  location: string | null;
  description: string;
  trade: BetaTrade | null;
  dueDate: string | null;
  photoKey: string;
  assigneePersonId: number | null;
}

const B = "/api/beta";

export const betaSiteApi = {
  site: (projectId: number): Promise<SiteView> => api.get<SiteView>(`${B}/projects/${projectId}/site`),
  defects: (projectId: number): Promise<{ defects: DefectTicket[] }> => api.get<{ defects: DefectTicket[] }>(`${B}/projects/${projectId}/defects`),
  report: (projectId: number, b: NewTicket): Promise<{ id: number }> => api.post<{ id: number }>(`${B}/projects/${projectId}/defects`, b),
  patchDefect: (defectId: number, b: DefectPatch): Promise<{ ok: true }> => api.patch<{ ok: true }>(`${B}/defects/${defectId}`, b),
  timeline: (projectId: number): Promise<{ entries: TimelineEntry[] }> => api.get<{ entries: TimelineEntry[] }>(`${B}/projects/${projectId}/timeline`),
};
