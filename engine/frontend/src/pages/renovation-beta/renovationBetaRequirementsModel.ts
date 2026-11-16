import type { RequirementGroup, RequirementLine, RequirementProject } from "./renovationBetaRequirementsApi";

export const NO_ROOM = "No room";

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
