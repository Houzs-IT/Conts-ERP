import type { SiteTask, SiteTaskBoard, SiteTaskStatus } from "./renovationBetaSiteTasksApi";

export const SITE_TASK_TABS = [
  ["open", "All open"],
  ["late", "Late"],
  ["in_progress", "In progress"],
  ["planned", "Planned"],
  ["no_dates", "No dates"],
  ["no_one", "No one on it"],
  ["history", "History"],
] as const;

export type SiteTaskTab = (typeof SITE_TASK_TABS)[number][0];

export const STATUS_LABEL: Record<SiteTaskStatus, string> = {
  overdue: "Late",
  late_start: "Not started",
  in_progress: "In progress",
  planned: "Planned",
  unscheduled: "No dates",
  done: "Done",
  skipped: "Skipped",
};

export const EVERYONE = "";

export function isLate(task: SiteTask): boolean {
  return task.status === "overdue" || task.status === "late_start";
}

export function hasNoOneOnIt(task: SiteTask): boolean {
  return task.isSubcontracted ? !task.supplierName : task.crew.length === 0;
}

const OPEN_TAB_RULES: Record<Exclude<SiteTaskTab, "history">, (task: SiteTask) => boolean> = {
  open: () => true,
  late: isLate,
  in_progress: (task) => task.status === "in_progress",
  planned: (task) => task.status === "planned",
  no_dates: (task) => task.status === "unscheduled",
  no_one: hasNoOneOnIt,
};

export function tasksOfTab(board: SiteTaskBoard, tab: SiteTaskTab): SiteTask[] {
  return tab === "history" ? board.history : board.open.filter(OPEN_TAB_RULES[tab]);
}

export function tabCounts(board: SiteTaskBoard): Record<SiteTaskTab, number> {
  return Object.fromEntries(SITE_TASK_TABS.map(([tab]) => [tab, tasksOfTab(board, tab).length])) as Record<SiteTaskTab, number>;
}

export function whoKeyOf(task: SiteTask): string[] {
  return task.isSubcontracted
    ? (task.supplierName ? [`supplier:${task.supplierName}`] : [])
    : task.crew.map((member) => `crew:${member.id}`);
}

export interface WhoOption {
  value: string;
  label: string;
}

export function whoOptions(tasks: readonly SiteTask[]): WhoOption[] {
  const options = new Map<string, string>();
  for (const task of tasks) {
    if (task.isSubcontracted && task.supplierName) options.set(`supplier:${task.supplierName}`, `${task.supplierName} (contractor)`);
    if (!task.isSubcontracted) for (const member of task.crew) options.set(`crew:${member.id}`, member.name);
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function whoLine(task: SiteTask): string {
  if (task.isSubcontracted) return task.supplierName ? `Contractor: ${task.supplierName}` : "No contractor yet";
  return task.crew.length ? task.crew.map((member) => member.name).join(", ") : "No crew yet";
}

export function matchesFilters(task: SiteTask, who: string, search: string): boolean {
  if (who !== EVERYONE && !whoKeyOf(task).includes(who)) return false;
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = [task.label, task.projectName, task.projectCode, task.building, task.unitNo, task.brand, whoLine(task)].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export interface ProjectGroup {
  projectId: number;
  label: string;
  brand: string | null;
  tasks: SiteTask[];
}

export function groupByProject(tasks: readonly SiteTask[]): ProjectGroup[] {
  const groups = new Map<number, ProjectGroup>();
  for (const task of tasks) {
    const group = groups.get(task.projectId)
      ?? { projectId: task.projectId, label: task.projectName ?? task.projectCode ?? `Project ${task.projectId}`, brand: task.brand, tasks: [] };
    group.tasks.push(task);
    groups.set(task.projectId, group);
  }
  return [...groups.values()];
}

export function brandOptions(tasks: readonly SiteTask[]): string[] {
  return [...new Set(tasks.map((task) => task.brand).filter((brand): brand is string => Boolean(brand)))].sort((a, b) => a.localeCompare(b));
}
