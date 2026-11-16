import { api } from "../../api/client";

export type RequirementGroup = "works" | "builtin";

export interface RequirementLine {
  id: string;
  itemCode: string;
  name: string;
  remark: string | null;
  qty: number;
  uom: string;
  room: string | null;
  group: RequirementGroup;
  isOnPo: boolean;
  planKey: string | null;
  tradeLabel: string | null;
  onSiteBy: string | null;
}

export type TradePlanStatus = "skipped" | "done" | "in_progress" | "overdue" | "late_start" | "planned" | "unscheduled";

export interface TradePlan {
  taskId: number;
  planKey: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: TradePlanStatus;
}

export interface RequirementProject {
  id: number;
  code: string | null;
  name: string;
  brand: string | null;
  lines: RequirementLine[];
  plans: TradePlan[];
}

export interface RequirementBoard {
  projects: RequirementProject[];
  isTruncated: boolean;
}

export const requirementsApi = {
  board: (): Promise<RequirementBoard> => api.get<RequirementBoard>("/api/beta/requirements"),
};
