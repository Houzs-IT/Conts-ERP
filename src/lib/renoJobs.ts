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
  photoCount: number;
}

export type RenoTradeState = 'open' | 'in_progress' | 'done';

export interface RenoPlan {
  taskId: number;
  planKey: string;
  label: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  status: RenoPlanStatus;
  state: RenoTradeState;
  startedOn: string | null;
}

export interface RenoTradeDay {
  day: number;
  date: string;
  updateCount: number;
  photoCount: number;
  by: string[];
}

export interface RenoTradeLog {
  planKey: string;
  days: RenoTradeDay[];
}

export interface RenoProject {
  id: number;
  code: string | null;
  name: string;
  brand: string | null;
  lines: RenoLine[];
  plans: RenoPlan[];
  tradeLog: RenoTradeLog[];
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
  photoCount: number;
}

export interface RenoTradeStartResponse {
  ok: true;
  startedOn: string;
}

export interface RenoTradeFinishResponse {
  ok: true;
  linesCompleted: number;
  closedTaskIds: number[];
  waitingForReceipt: boolean;
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
export const WORKS_LABEL = 'Works';
export const MAX_PROOF_PHOTOS = 10;

const PHOTO_LONGEST_SIDE = 1600;
const PHOTO_QUALITY = 0.8;
const KUALA_LUMPUR_OFFSET_MS = 8 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export function parseCount(raw: string): number | null {
  const trimmed = raw.trim();
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : null;
}

export function formatDoneDay(isoInstant: string | null): string | null {
  const time = isoInstant ? Date.parse(isoInstant) : Number.NaN;
  return Number.isFinite(time) ? formatDayMonth(new Date(time + KUALA_LUMPUR_OFFSET_MS).toISOString()) : null;
}

export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    return blob ? new File([blob], `${file.name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
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

export function sortedLines(lines: RenoLine[]): RenoLine[] {
  return [...lines].sort((first, second) => first.itemCode.localeCompare(second.itemCode, undefined, { numeric: true }));
}

const STATUS_URGENCY: RenoPlanStatus[] = ['overdue', 'late_start', 'in_progress', 'planned', 'unscheduled', 'done', 'skipped'];

export function mergeTradeState(plans: Pick<RenoPlan, 'status' | 'state'>[]): RenoTradeState {
  const live = plans.filter(plan => plan.status !== 'skipped');
  if (live.length > 0 && live.every(plan => plan.state === 'done')) return 'done';
  return live.some(plan => plan.state !== 'open') ? 'in_progress' : 'open';
}

export function mergePlans(plans: RenoPlan[]): RenoPlan | null {
  const [first] = plans;
  if (!first) return null;
  const live = plans.filter(plan => plan.status !== 'skipped');
  const taskId = (live.find(plan => plan.state !== 'done') ?? live[0] ?? first).taskId;
  const startedOn = plans.flatMap(plan => (plan.startedOn ? [plan.startedOn] : [])).sort()[0] ?? null;
  const starts = plans.flatMap(plan => (plan.plannedStart ? [plan.plannedStart] : [])).sort();
  const ends = plans.flatMap(plan => (plan.plannedEnd ? [plan.plannedEnd] : [])).sort();
  const status = STATUS_URGENCY.find(candidate => plans.some(plan => plan.status === candidate)) ?? first.status;
  return { ...first, taskId, state: mergeTradeState(plans), startedOn, status, plannedStart: starts[0] ?? null, plannedEnd: ends[ends.length - 1] ?? null };
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
    const plan = mergePlans(plans.filter(candidate => candidate.planKey === line.planKey));
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
    const carpentryPlan = firstBuiltIn ? mergePlans(project.plans.filter(plan => plan.planKey === firstBuiltIn.planKey)) : null;
    return {
      room,
      lines,
      trades: groupByTrade(lines.filter(line => line.group === 'works'), project.plans, WORKS_LABEL),
      carpentry: builtInLines.length > 0 ? { key: 'carpentry', label: CARPENTRY_LABEL, plan: carpentryPlan, lines: builtInLines } : null,
    };
  });
}

export function tradeDayNumber(startedOn: string | null, now: number = Date.now()): number | null {
  const started = startedOn ? Date.parse(`${startedOn.slice(0, 10)}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(started)) return null;
  const today = Date.parse(`${new Date(now + KUALA_LUMPUR_OFFSET_MS).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.max(1, Math.round((today - started) / MS_PER_DAY) + 1);
}

export function linesToFinish(lines: RenoLine[]): RenoLine[] {
  return lines.filter(line => !isLineDone(line));
}

export function latestDoneDay(lines: Pick<RenoLine, 'doneAt'>[]): string | null {
  const latest = lines.flatMap(line => (line.doneAt ? [line.doneAt] : [])).sort().pop();
  return formatDoneDay(latest ?? null);
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
