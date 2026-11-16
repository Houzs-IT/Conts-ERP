export type RenoLineGroup = 'works' | 'builtin';

export type RenoPlanStatus = 'skipped' | 'done' | 'in_progress' | 'overdue' | 'late_start' | 'planned' | 'unscheduled';

export interface RenoLine {
  id: string;
  itemCode: string;
  name: string;
  remark: string | null;
  qty: number;
  uom: string;
  room: string | null;
  group: RenoLineGroup;
  isOnPo: boolean;
  planKey: string | null;
  tradeLabel: string | null;
  onSiteBy: string | null;
  doneQty: number;
  doneAt: string | null;
  isTradeClosed: boolean;
}

export interface RenoPlan {
  taskId: number;
  planKey: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: RenoPlanStatus;
}

export interface RenoProject {
  id: number;
  code: string | null;
  name: string;
  brand: string | null;
  lines: RenoLine[];
  plans: RenoPlan[];
}

export interface RenoJobsResponse {
  brand: string;
  areTicksReady: boolean;
  projects: RenoProject[];
}

export interface RenoProgressResponse {
  ok: true;
  previousDoneQty: number;
  doneQty: number;
  completedTaskIds: number[];
}

export interface RenoTradeGroup {
  key: string;
  label: string;
  plan: RenoPlan | null;
  lines: RenoLine[];
}

export interface RenoRoomGroup {
  room: string;
  trades: RenoTradeGroup[];
  carpentry: RenoTradeGroup | null;
  lines: RenoLine[];
}

export interface RenoProjectSummary {
  worksCount: number;
  builtInCount: number;
  doneLineCount: number;
  lineCount: number;
  isLate: boolean;
}

export const NO_ROOM_LABEL = 'No room';
export const CARPENTRY_LABEL = 'Carpentry';

const roundCount = (value: number): number => Math.round(value * 100) / 100;

export function formatCount(value: number): string {
  return String(roundCount(value));
}

export function clampDoneCount(value: number, qty: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundCount(Math.min(Math.max(value, 0), Math.max(qty, 0)));
}

export function isLineDone(line: Pick<RenoLine, 'qty' | 'doneQty'>): boolean {
  return line.qty > 0 && line.doneQty >= line.qty;
}

export function doneText(doneQty: number, qty: number): string {
  return `${formatCount(doneQty)} of ${formatCount(qty)}`;
}

export function formatDayMonth(isoDate: string | null): string | null {
  const match = isoDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, , month, day] = match;
  return `${day}/${month}`;
}

export function formatPlanDates(plan: Pick<RenoPlan, 'plannedStart' | 'plannedEnd'>): string | null {
  const start = formatDayMonth(plan.plannedStart);
  const end = formatDayMonth(plan.plannedEnd);
  if (start && end) return start === end ? start : `${start} to ${end}`;
  return start ?? end;
}

export function isPlanLate(plan: Pick<RenoPlan, 'status'>): boolean {
  return plan.status === 'overdue' || plan.status === 'late_start';
}

export const PLAN_STATUS_LABEL: Record<RenoPlanStatus, string> = {
  skipped: 'Skipped',
  done: 'Done',
  in_progress: 'In progress',
  overdue: 'Late',
  late_start: 'Late to start',
  planned: 'Planned',
  unscheduled: 'Not planned yet',
};

export function sortedLines(lines: RenoLine[]): RenoLine[] {
  return [...lines].sort((first, second) => first.itemCode.localeCompare(second.itemCode, undefined, { numeric: true }));
}

function groupByTrade(lines: RenoLine[], plans: RenoPlan[], fallbackLabel: string): RenoTradeGroup[] {
  const groups = new Map<string, RenoTradeGroup>();
  for (const line of lines) {
    const key = line.planKey ?? `label:${line.tradeLabel ?? fallbackLabel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    const plan = plans.find(candidate => candidate.planKey === line.planKey) ?? null;
    groups.set(key, { key, label: plan?.label ?? line.tradeLabel ?? fallbackLabel, plan, lines: [line] });
  }
  return [...groups.values()];
}

export function groupByRoom(project: Pick<RenoProject, 'lines' | 'plans'>): RenoRoomGroup[] {
  const rooms = new Map<string, RenoLine[]>();
  for (const line of sortedLines(project.lines)) {
    const room = line.room?.trim() || NO_ROOM_LABEL;
    rooms.set(room, [...(rooms.get(room) ?? []), line]);
  }
  return [...rooms.entries()].map(([room, lines]) => {
    const builtInLines = lines.filter(line => line.group === 'builtin');
    const [firstBuiltIn] = builtInLines;
    const carpentryPlan = firstBuiltIn ? project.plans.find(plan => plan.planKey === firstBuiltIn.planKey) ?? null : null;
    return {
      room,
      lines,
      trades: groupByTrade(lines.filter(line => line.group === 'works'), project.plans, 'Works'),
      carpentry: builtInLines.length > 0 ? { key: 'carpentry', label: CARPENTRY_LABEL, plan: carpentryPlan, lines: builtInLines } : null,
    };
  });
}

export function summarizeProject(project: Pick<RenoProject, 'lines' | 'plans'>): RenoProjectSummary {
  return {
    worksCount: project.lines.filter(line => line.group === 'works').length,
    builtInCount: project.lines.filter(line => line.group === 'builtin').length,
    doneLineCount: project.lines.filter(isLineDone).length,
    lineCount: project.lines.length,
    isLate: project.plans.some(isPlanLate),
  };
}
