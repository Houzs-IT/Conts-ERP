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
}

export interface RequirementProject {
  id: number;
  code: string | null;
  name: string;
  brand: string | null;
  lines: RequirementLine[];
}

export interface RequirementBoard {
  projects: RequirementProject[];
  isTruncated: boolean;
}

export const requirementsApi = {
  board: (): Promise<RequirementBoard> => api.get<RequirementBoard>("/api/beta/requirements"),
};
