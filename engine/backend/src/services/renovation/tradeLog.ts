import { metaOf } from "./betaMedia";

export const TRADE_LOG_DAY_LIMIT = 14;

export interface TradeMediaRow {
  project_id: number | string;
  target: string;
  day: string;
  note: string | null;
}

export interface TradeLogDay {
  day: number;
  date: string;
  updateCount: number;
  photoCount: number;
  by: string[];
}

export interface TradeLog {
  planKey: string;
  days: TradeLogDay[];
}

export interface TradeLogTask {
  taskId: number;
  planKey: string;
  actualStart: string | null;
}

export interface TradeLogLine {
  id: string;
  planKey: string | null;
}

interface DayTotals {
  targets: Set<string>;
  photoCount: number;
  by: Set<string>;
}

const MS_PER_DAY = 86_400_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function stageOf(note: string | null): string | null {
  if (!note?.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(note);
    return isRecord(parsed) && typeof parsed.stage === "string" ? parsed.stage : null;
  } catch {
    return null;
  }
}

export function finishedTaskIds(rows: readonly TradeMediaRow[]): Set<number> {
  const ids = new Set<number>();
  for (const { target, note } of rows) {
    const match = /^task:(\d+)$/.exec(target);
    if (match && stageOf(note) === "finish") ids.add(Number(match[1]));
  }
  return ids;
}

const dayNumber = (startDate: string, date: string): number =>
  Math.max(1, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / MS_PER_DAY) + 1);

export function buildTradeLogs(tasks: readonly TradeLogTask[], lines: readonly TradeLogLine[], media: readonly TradeMediaRow[]): TradeLog[] {
  const planKeyByTarget = new Map<string, string>();
  const startByPlan = new Map<string, string>();
  for (const { taskId, planKey, actualStart } of tasks) {
    planKeyByTarget.set(`task:${taskId}`, planKey);
    const start = actualStart?.slice(0, 10) ?? null;
    if (start && (startByPlan.get(planKey) ?? start) >= start) startByPlan.set(planKey, start);
  }
  for (const { id, planKey } of lines) {
    if (planKey) planKeyByTarget.set(`line:${id}`, planKey);
  }
  const totalsByPlan = new Map<string, Map<string, DayTotals>>();
  for (const { target, day, note } of media) {
    const planKey = planKeyByTarget.get(target);
    if (!planKey) continue;
    const planDays = totalsByPlan.get(planKey) ?? new Map<string, DayTotals>();
    const totals = planDays.get(day) ?? { targets: new Set<string>(), photoCount: 0, by: new Set<string>() };
    totals.targets.add(target);
    totals.photoCount += 1;
    const by = metaOf(note, "").by;
    if (by) totals.by.add(by);
    planDays.set(day, totals);
    totalsByPlan.set(planKey, planDays);
  }
  return [...totalsByPlan].map(([planKey, planDays]) => {
    const dates = [...planDays.keys()].sort();
    const startDate = startByPlan.get(planKey) ?? dates[0];
    return {
      planKey,
      days: dates.reverse().slice(0, TRADE_LOG_DAY_LIMIT).map((date) => {
        const totals = planDays.get(date);
        return { day: dayNumber(startDate, date), date, updateCount: totals?.targets.size ?? 0, photoCount: totals?.photoCount ?? 0, by: [...(totals?.by ?? [])] };
      }),
    };
  });
}
