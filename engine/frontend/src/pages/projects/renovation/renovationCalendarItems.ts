/* Calendar Week view in renovation mode (owner, 15 Oct 2026): dated items, one chip per item per day, instead of
   project bars. Wire type of GET /api/projects/calendar/events?items=1 `renoItems`
   (engine/backend/src/services/renovation/calendarItems.ts) and the pure filtering / grouping. */

export type RenoItemKind = "onsite" | "3d" | "2d" | "po" | "delivery" | "task" | "handover";

export interface RenoCalendarItem {
  key: string;
  projectId: number;
  projectName: string;
  short: string;
  date: string;
  kind: RenoItemKind;
  what: string;
  done: boolean;
  brand: string | null;
  status: string | null;
  organizer: string | null;
}

export const RENO_ITEM_KINDS: ReadonlyArray<{ kind: RenoItemKind; label: string }> = [
  { kind: "onsite", label: "Design onsite" },
  { kind: "3d", label: "3D submission" },
  { kind: "2d", label: "2D submission" },
  { kind: "po", label: "PO date" },
  { kind: "delivery", label: "Delivery" },
  { kind: "task", label: "Site task" },
  { kind: "handover", label: "Planned handover" },
];

/** Chip colours per kind: one distinct hue each (the theme's own soft tones are too alike side by side). */
export const RENO_ITEM_CLASS: Readonly<Record<RenoItemKind, string>> = {
  onsite: "border-[#8fcfc6] bg-[#e3f3f1] text-[#145c55]",
  "3d": "border-[#c4b2ea] bg-[#efe9fb] text-[#55308f]",
  "2d": "border-learning/30 bg-learning/10 text-learning",
  po: "border-warning-text/30 bg-warning-bg text-warning-text",
  delivery: "border-synced/40 bg-synced-bg text-synced",
  task: "border-border-strong bg-surface-2 text-ink-secondary",
  handover: "border-primary bg-primary text-white",
};

/** The calendar toolbar's filters (brand, status, organizer, search) applied to items. */
export function filterRenoItems(items: readonly RenoCalendarItem[], f: { brand: string; status: string; organizer: string; q: string }): RenoCalendarItem[] {
  const needle = f.q.trim().toLowerCase();
  return items.filter((i) => {
    if (f.brand && i.brand !== f.brand) return false;
    if (f.status && (i.status ?? "").toLowerCase() !== f.status) return false;
    if (f.organizer && (i.organizer ?? "") !== f.organizer) return false;
    if (needle && ![i.projectName, i.short, i.what].join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function itemsByDate(items: readonly RenoCalendarItem[]): Map<string, RenoCalendarItem[]> {
  const out = new Map<string, RenoCalendarItem[]>();
  for (const i of items) {
    const list = out.get(i.date);
    if (list) list.push(i);
    else out.set(i.date, [i]);
  }
  return out;
}

/** "<project short name> · <what>" */
export function itemLabel(i: Pick<RenoCalendarItem, "short" | "what">): string {
  return `${i.short} · ${i.what}`;
}
