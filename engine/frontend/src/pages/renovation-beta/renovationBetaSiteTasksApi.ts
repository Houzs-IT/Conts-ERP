import { api } from "../../api/client";

export type SiteTaskStatus = "skipped" | "done" | "in_progress" | "overdue" | "late_start" | "planned" | "unscheduled";

export interface SiteTaskCrewMember {
  id: number;
  name: string;
}

export interface SiteTask {
  id: number;
  projectId: number;
  projectCode: string | null;
  projectName: string | null;
  building: string | null;
  unitNo: string | null;
  brand: string | null;
  label: string;
  isSubcontracted: boolean;
  supplierName: string | null;
  crew: SiteTaskCrewMember[];
  plannedStart: string | null;
  plannedEnd: string | null;
  finishedOn: string | null;
  lastPhotoAt: string | null;
  status: SiteTaskStatus;
}

export interface SiteTaskBoard {
  open: SiteTask[];
  history: SiteTask[];
  isTruncated: boolean;
}

export const siteTasksApi = {
  board: (): Promise<SiteTaskBoard> => api.get<SiteTaskBoard>("/api/beta/site-tasks"),
};
