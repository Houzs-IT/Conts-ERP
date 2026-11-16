import type { RequirementGroup, RequirementLine, RequirementProject, TradePlan, TradePlanStatus } from "./renovationBetaRequirementsApi";
import { dayMonth } from "./renovationBetaModel";

export const NO_ROOM = "No room";

export const PLAN_STATUS_LABEL: Record<TradePlanStatus, string> = {
  overdue: "Late",
  late_start: "Not started",
  in_progress: "In progress",
  planned: "Planned",
  unscheduled: "No dates",
  done: "Done",
  skipped: "Skipped",
};

export function isPlanLate(status: TradePlanStatus): boolean {
  return status === "overdue" || status === "late_start";
}

export function planDates({ plannedStart, plannedEnd }: Pick<TradePlan, "plannedStart" | "plannedEnd">): string {
  if (plannedStart && plannedEnd && plannedStart !== plannedEnd) return `${dayMonth(plannedStart)} to ${dayMonth(plannedEnd)}`;
  if (plannedStart ?? plannedEnd) return dayMonth(plannedStart ?? plannedEnd);
  return "No dates";
}

export interface TradeGroup {
  key: string;
  label: string;
  lines: RequirementLine[];
  plans: TradePlan[];
}

export const BUILT_IN_PLAN_KEY = "BUILTIN";

const tradeLabelOf = (line: RequirementLine): string =>
  line.planKey === BUILT_IN_PLAN_KEY ? "Carpentry" : line.name.replace(/^works\s*-\s*/i, "");

export function groupByTrade(lines: readonly RequirementLine[], plans: readonly TradePlan[]): TradeGroup[] {
  const trades = new Map<string, TradeGroup>();
  for (const line of lines) {
    const key = line.planKey ?? line.itemCode;
    const trade = trades.get(key) ?? { key, label: tradeLabelOf(line), lines: [], plans: plans.filter((plan) => plan.planKey === key) };
    trade.lines.push(line);
    trades.set(key, trade);
  }
  return [...trades.values()];
}

const GROUP_LABELS: ReadonlyArray<readonly [RequirementGroup, string]> = [
  ["works", "Works"],
  ["builtin", "Built-in"],
];

export interface GroupCard {
  key: RequirementGroup;
  label: string;
  lines: RequirementLine[];
}

export interface RoomGroup {
  name: string;
  lines: RequirementLine[];
  cards: GroupCard[];
}

export function groupCards(lines: readonly RequirementLine[]): GroupCard[] {
  return GROUP_LABELS
    .map(([key, label]) => ({ key, label, lines: lines.filter((line) => line.group === key) }))
    .filter((card) => card.lines.length > 0);
}

export function groupByRoom(lines: readonly RequirementLine[]): RoomGroup[] {
  const rooms = new Map<string, RequirementLine[]>();
  for (const line of lines) {
    const name = line.room ?? NO_ROOM;
    const roomLines = rooms.get(name) ?? [];
    roomLines.push(line);
    rooms.set(name, roomLines);
  }
  return [...rooms].map(([name, roomLines]) => ({ name, lines: roomLines, cards: groupCards(roomLines) }));
}

export function onPoCount(lines: readonly RequirementLine[]): number {
  return lines.filter((line) => line.isOnPo).length;
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function roomSummary(room: RoomGroup): string {
  return room.cards.map((card) => `${card.label} ${card.lines.length}`).join(" · ");
}

function searchWords(search: string): string[] {
  return search.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function filterProjectLines(project: RequirementProject, search: string): RequirementLine[] {
  const words = searchWords(search);
  if (words.length === 0) return project.lines;
  const projectText = [project.name, project.code, project.brand].join(" ");
  return project.lines.filter((line) => {
    const haystack = [projectText, line.room ?? NO_ROOM, line.itemCode, line.name, line.remark].join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function brandOptions(projects: readonly RequirementProject[]): string[] {
  return [...new Set(projects.map((project) => project.brand).filter((brand): brand is string => Boolean(brand)))].sort((a, b) => a.localeCompare(b));
}
