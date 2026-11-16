import { lineVisible, type CategoryScope } from "../categoryAccess";

export const REQUIREMENT_LINE_LIMIT = 5000;

export type RequirementGroup = "works" | "builtin";

const GROUP_OF_CATEGORY: Readonly<Partial<Record<string, RequirementGroup>>> = {
  WORKS: "works",
  BUILTIN: "builtin",
};

export const BOARD_CATEGORY_CODES: readonly string[] = Object.keys(GROUP_OF_CATEGORY);

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

const trimmedOrNull = (value: string | null): string | null => value?.trim() || null;

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
  };
}

export function buildRequirementBoard(
  projectRows: readonly RequirementProjectRow[],
  lineRows: readonly RequirementLineRow[],
  scope: CategoryScope | null,
): RequirementBoard {
  const linesByProject = new Map<number, RequirementLine[]>();
  for (const row of lineRows) {
    const line = lineVisible(scope, row.cat_code, row.sub_code) ? requirementLineOf(row) : null;
    if (!line) continue;
    const projectId = Number(row.project_id);
    const projectLines = linesByProject.get(projectId) ?? [];
    projectLines.push(line);
    linesByProject.set(projectId, projectLines);
  }
  const projects = projectRows.map((row) => {
    const id = Number(row.project_id);
    return { id, code: row.project_code, name: row.project_name ?? row.project_code ?? `Project ${id}`, brand: trimmedOrNull(row.brand), lines: linesByProject.get(id) ?? [] };
  });
  return {
    projects: [...projects.filter((project) => project.lines.length > 0), ...projects.filter((project) => project.lines.length === 0)],
    isTruncated: lineRows.length >= REQUIREMENT_LINE_LIMIT,
  };
}
