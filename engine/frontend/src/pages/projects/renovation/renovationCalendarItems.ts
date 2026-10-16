/* Renovation calendar items (owner, 15 Oct 2026; Notion-style cards, 16 Oct 2026). Wire type of
   GET /api/projects/calendar/events?items=1 `renoItems` (engine/backend/src/services/renovation/calendarItems.ts)
   and the pure filtering / grouping shared by the desktop calendar and the Houzs phone app's week. */

export type RenoItemKind = "onsite" | "3d" | "2d" | "amendment" | "po" | "delivery" | "task" | "handover";
export type RenoDepartment = "design" | "sales" | "renovation" | "management" | "site_crew";

export interface RenoPerson {
  id: number;
  name: string;
  roles: string[];
}

export interface RenoCalendarItem {
  key: string;
  projectId: number;
  projectName: string;
  projectCode?: string | null;
  short: string;
  /** first day */
  date: string;
  /** last day, inclusive; missing from an older server, then the item is one day */
  end?: string;
  kind: RenoItemKind;
  /** upper-case heading; missing from an older server */
  title?: string;
  what: string;
  done: boolean;
  people?: RenoPerson[];
  department?: RenoDepartment;
  supplier?: string | null;
  brand: string | null;
  status: string | null;
  organizer: string | null;
}

export const RENO_ITEM_KINDS: ReadonlyArray<{ kind: RenoItemKind; label: string }> = [
  { kind: "onsite", label: "Site measure" },
  { kind: "3d", label: "3D submission" },
  { kind: "2d", label: "2D submission" },
  { kind: "amendment", label: "Design amendment" },
  { kind: "po", label: "PO date" },
  { kind: "delivery", label: "Delivery" },
  { kind: "task", label: "Site task" },
  { kind: "handover", label: "Planned handover" },
];

/** Chip colours per kind (the Houzs phone app's week): one distinct hue each. */
export const RENO_ITEM_CLASS: Readonly<Record<RenoItemKind, string>> = {
  onsite: "border-[#8fcfc6] bg-[#e3f3f1] text-[#145c55]",
  "3d": "border-[#c4b2ea] bg-[#efe9fb] text-[#55308f]",
  "2d": "border-learning/30 bg-learning/10 text-learning",
  amendment: "border-learning/30 bg-learning/10 text-learning",
  po: "border-warning-text/30 bg-warning-bg text-warning-text",
  delivery: "border-synced/40 bg-synced-bg text-synced",
  task: "border-border-strong bg-surface-2 text-ink-secondary",
  handover: "border-primary bg-primary text-white",
};

/** Last day of an item (its first day when the server sent no end). */
export const itemEnd = (i: Pick<RenoCalendarItem, "date" | "end">): string => (i.end && i.end >= i.date ? i.end : i.date);

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

const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 62;

/** Items by day; a multi-day item sits on every day it covers. */
export function itemsByDate(items: readonly RenoCalendarItem[]): Map<string, RenoCalendarItem[]> {
  const out = new Map<string, RenoCalendarItem[]>();
  for (const i of items) {
    const last = itemEnd(i);
    let ms = Date.parse(`${i.date}T00:00:00Z`);
    for (let n = 0; n < MAX_SPAN_DAYS; n++, ms += DAY_MS) {
      const d = new Date(ms).toISOString().slice(0, 10);
      if (d > last) break;
      const list = out.get(d);
      if (list) list.push(i);
      else out.set(d, [i]);
    }
  }
  return out;
}

/** "<project short name> · <what>" */
export function itemLabel(i: Pick<RenoCalendarItem, "short" | "what">): string {
  return `${i.short} · ${i.what}`;
}
