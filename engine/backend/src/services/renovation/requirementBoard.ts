import { lineVisible, type CategoryScope } from "../categoryAccess";
import { tradeTaskStatus, type TaskStatus } from "./tradeTasks";

export const REQUIREMENT_LINE_LIMIT = 5000;

export type RequirementGroup = "works" | "builtin";

const GROUP_OF_CATEGORY: Readonly<Partial<Record<string, RequirementGroup>>> = {
  WORKS: "works",
  BUILTIN: "builtin",
};

export const BOARD_CATEGORY_CODES: readonly string[] = Object.keys(GROUP_OF_CATEGORY);

export const BUILT_IN_PLAN_KEY = "BUILTIN";

const BUILT_IN_TASK_CATEGORY = "CARPENTRY";

export interface RequirementProjectRow {
  project_id: number;
  project_code: string | null;
  project_name: string | null;
  brand: string | null;
}

export interface RequirementLineRow {
  id: string;
  project_id: number;
  item_code: string | null;
  description: string | null;
  remark: string | null;
  qty: number | string;
  uom: string | null;
  room: string | null;
  cat_code: string;
  sub_code: string | null;
  is_on_po: boolean;
  deliver_on: string | null;
}

export interface TradePlanRow {
  id: number;
  project_id: number;
  trade_code: string;
  category_code: string | null;
  label: string | null;
  state: string;
  fulfilment_kind: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  po_fully_received: boolean | null;
}

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
  onSiteBy: string | null;
}

export interface TradePlan {
  taskId: number;
  planKey: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: TaskStatus;
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

export interface RequirementBoardRows {
  projects: readonly RequirementProjectRow[];
  lines: readonly RequirementLineRow[];
  plans: readonly TradePlanRow[];
}

const trimmedOrNull = (value: string | null): string | null => value?.trim() || null;

const dayOf = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

export function requirementLineOf(row: RequirementLineRow): RequirementLine | null {
  const group = GROUP_OF_CATEGORY[row.cat_code];
  if (!group) return null;
  const itemCode = row.item_code ?? "";
  return {
    id: row.id,
    itemCode,
    name: trimmedOrNull(row.description) ?? itemCode,
    remark: trimmedOrNull(row.remark),
    qty: Number(row.qty),
    uom: row.uom ?? "UNIT",
    room: trimmedOrNull(row.room),
    group,
    isOnPo: row.is_on_po,
    planKey: group === "builtin" ? BUILT_IN_PLAN_KEY : row.sub_code,
    onSiteBy: dayOf(row.deliver_on),
  };
}

export function planKeyOfTask(row: Pick<TradePlanRow, "trade_code" | "category_code">): string | null {
  if (row.category_code === BUILT_IN_TASK_CATEGORY) return BUILT_IN_PLAN_KEY;
  return row.trade_code.includes(":") ? null : row.trade_code;
}

export function tradePlanOf(row: TradePlanRow, today: string): TradePlan | null {
  const planKey = planKeyOfTask(row);
  if (!planKey) return null;
  return {
    taskId: Number(row.id),
    planKey,
    label: trimmedOrNull(row.label) ?? planKey,
    plannedStart: dayOf(row.planned_start),
    plannedEnd: dayOf(row.planned_end),
    status: tradeTaskStatus({ ...row, poFullyReceived: row.po_fully_received === true }, today),
  };
}

function groupByProject<T>(items: readonly T[], projectIdOf: (item: T) => number): Map<number, T[]> {
  const byProject = new Map<number, T[]>();
  for (const item of items) {
    const projectId = projectIdOf(item);
    const projectItems = byProject.get(projectId) ?? [];
    projectItems.push(item);
    byProject.set(projectId, projectItems);
  }
  return byProject;
}

export function buildRequirementBoard(rows: RequirementBoardRows, scope: CategoryScope | null, today: string): RequirementBoard {
  const visibleLines = rows.lines.filter((row) => lineVisible(scope, row.cat_code, row.sub_code));
  const linesByProject = groupByProject(visibleLines, (row) => Number(row.project_id));
  const plansByProject = groupByProject(rows.plans, (row) => Number(row.project_id));
  const projects = rows.projects.map((row) => {
    const id = Number(row.project_id);
    return {
      id,
      code: row.project_code,
      name: row.project_name ?? row.project_code ?? `Project ${id}`,
      brand: trimmedOrNull(row.brand),
      lines: (linesByProject.get(id) ?? []).map(requirementLineOf).filter((line): line is RequirementLine => line !== null),
      plans: (plansByProject.get(id) ?? []).map((plan) => tradePlanOf(plan, today)).filter((plan): plan is TradePlan => plan !== null),
    };
  });
  return {
    projects: [...projects.filter((project) => project.lines.length > 0), ...projects.filter((project) => project.lines.length === 0)],
    isTruncated: rows.lines.length >= REQUIREMENT_LINE_LIMIT,
  };
}
