/* The renovation calendar, laid out like the team's Notion calendar (owner, 16 Oct 2026): a Sunday-first month or
   week of coloured task cards, coloured by department, filtered by department, person, "my tasks", project and
   status, every filter kept in the URL. Pure: dates, filters, the per-week lanes multi-day cards span across. */

import { itemEnd, type RenoCalendarItem, type RenoDepartment, type RenoPerson } from "./renovationCalendarItems";

// ── Departments ───────────────────────────────────────────────

export interface DepartmentStyle {
  key: RenoDepartment;
  label: string;
  /** card: pastel fill, border, ink that reads on the fill (contrast over 7:1) */
  card: string;
  /** the solid swatch / avatar fill */
  dot: string;
  /** avatar initial on the dot */
  dotInk: string;
}

/* Pastel fills with dark ink of the same hue; every department also shows its name as text on the card. */
export const RENO_DEPARTMENTS: readonly DepartmentStyle[] = [
  { key: "design", label: "Design", card: "border-[#a9c6ef] bg-[#e6effc] text-[#173f73]", dot: "#4a83d4", dotInk: "#ffffff" },
  { key: "sales", label: "Sales", card: "border-[#f1bf9f] bg-[#fde9dd] text-[#723411]", dot: "#d9783c", dotInk: "#ffffff" },
  { key: "renovation", label: "Renovation", card: "border-[#a6d3ae] bg-[#e3f3e6] text-[#1b5527]", dot: "#3f9150", dotInk: "#ffffff" },
  { key: "management", label: "Management", card: "border-[#eeb1cb] bg-[#fbe5ef] text-[#771f45]", dot: "#c94f86", dotInk: "#ffffff" },
  { key: "site_crew", label: "Site crew", card: "border-[#e2cb78] bg-[#fbf2d3] text-[#574205]", dot: "#b48a0e", dotInk: "#ffffff" },
];
export const DEPARTMENT_BY_KEY: Readonly<Record<RenoDepartment, DepartmentStyle>> = Object.fromEntries(
  RENO_DEPARTMENTS.map((d) => [d.key, d]),
) as Record<RenoDepartment, DepartmentStyle>;

const ROLE_DEPARTMENT: Readonly<Record<string, RenoDepartment>> = {
  designer: "design", sales: "sales", reno_pic: "renovation", admin: "management", boss: "management", site_crew: "site_crew",
};
const DEPARTMENT_ORDER: readonly RenoDepartment[] = ["design", "renovation", "sales", "site_crew", "management"];

/** A person's department: the most telling of their roles, null without one. */
export function personDepartment(p: Pick<RenoPerson, "roles">): RenoDepartment | null {
  const set = new Set((p.roles ?? []).map((r) => ROLE_DEPARTMENT[r]).filter(Boolean));
  return DEPARTMENT_ORDER.find((d) => set.has(d)) ?? null;
}

const KIND_DEPARTMENT: Readonly<Record<RenoCalendarItem["kind"], RenoDepartment>> = {
  onsite: "design", "3d": "design", "2d": "design", amendment: "design", po: "renovation", delivery: "renovation", task: "renovation", handover: "renovation",
};
/** The department the server worked out; from an older server, the kind's own. */
export const itemDepartment = (i: Pick<RenoCalendarItem, "department" | "kind">): RenoDepartment => i.department ?? KIND_DEPARTMENT[i.kind];

export type RenoItemStatus = "done" | "overdue" | "open";
/** Done; a task or an amendment past its last day and not done is overdue; anything else open. */
export function itemStatus(i: Pick<RenoCalendarItem, "done" | "kind" | "date" | "end">, today: string): RenoItemStatus {
  if (i.done) return "done";
  if ((i.kind === "task" || i.kind === "amendment") && itemEnd(i) < today) return "overdue";
  return "open";
}
export const STATUS_LABEL: Readonly<Record<RenoItemStatus, string>> = { done: "Done", overdue: "Overdue", open: "To do" };

/** "2D AMENDMENT" — the server's heading, or one made from what it is. */
export const itemTitle = (i: Pick<RenoCalendarItem, "title" | "what">): string => (i.title || i.what).toUpperCase();

/** Up to two letters for an avatar: "YING TZY" -> "YT", "Alex" -> "A". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 1) : parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ── Filters (URL) ─────────────────────────────────────────────

export interface RenoCalendarFilters {
  depts: RenoDepartment[];
  people: number[];
  mine: boolean;
  q: string;
  state: "" | "open" | "done";
}
export const RENO_FILTER_KEYS = ["dept", "person", "mine", "q", "state"] as const;

export function parseRenoFilters(params: URLSearchParams): RenoCalendarFilters {
  const valid = new Set(RENO_DEPARTMENTS.map((d) => d.key));
  const depts = (params.get("dept") ?? "").split(",").filter((d): d is RenoDepartment => valid.has(d as RenoDepartment));
  const people = (params.get("person") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const state = params.get("state");
  return {
    depts: [...new Set(depts)],
    people: [...new Set(people)],
    mine: params.get("mine") === "1",
    q: params.get("q") ?? "",
    state: state === "open" || state === "done" ? state : "",
  };
}

/** URL values for a filter change; "" removes the key. */
export function renoFilterPatch(f: Partial<RenoCalendarFilters>): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.depts) out.dept = f.depts.join(",");
  if (f.people) out.person = f.people.join(",");
  if (f.mine !== undefined) out.mine = f.mine ? "1" : "";
  if (f.q !== undefined) out.q = f.q;
  if (f.state !== undefined) out.state = f.state;
  return out;
}

export const activeFilterCount = (f: RenoCalendarFilters): number =>
  (f.depts.length ? 1 : 0) + (f.people.length ? 1 : 0) + (f.mine ? 1 : 0) + (f.q.trim() ? 1 : 0) + (f.state ? 1 : 0);

/** Items passing every filter. People and "my tasks" both keep an item one of whose people is picked / is me. */
export function applyRenoFilters(items: readonly RenoCalendarItem[], f: RenoCalendarFilters, me: readonly number[]): RenoCalendarItem[] {
  const needle = f.q.trim().toLowerCase();
  const depts = new Set(f.depts);
  const people = new Set(f.people);
  const mine = new Set(me);
  return items.filter((i) => {
    if (depts.size && !depts.has(itemDepartment(i))) return false;
    const ids = (i.people ?? []).map((p) => p.id);
    if (people.size && !ids.some((id) => people.has(id))) return false;
    if (f.mine && !ids.some((id) => mine.has(id))) return false;
    if (f.state === "done" && !i.done) return false;
    if (f.state === "open" && i.done) return false;
    if (needle && ![i.projectName, i.short, i.projectCode ?? "", i.title ?? "", i.what].join(" ").toLowerCase().includes(needle)) return false;
    return true;
  });
}

export interface PersonOption { person: RenoPerson; department: RenoDepartment | null; count: number }
/** Everyone on the period's items, with how many items each, by name. */
export function peopleOnItems(items: readonly RenoCalendarItem[]): PersonOption[] {
  const m = new Map<number, PersonOption>();
  for (const i of items) {
    for (const p of i.people ?? []) {
      const cur = m.get(p.id);
      if (cur) cur.count += 1;
      else m.set(p.id, { person: p, department: personDepartment(p), count: 1 });
    }
  }
  return [...m.values()].sort((a, b) => a.person.name.localeCompare(b.person.name));
}

// ── Dates ─────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number): string => new Date(ms(iso) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / DAY_MS);
const dow = (iso: string) => new Date(ms(iso)).getUTCDay();
/** The Sunday on or before a day. */
export const sundayOf = (iso: string): string => addDays(iso, -dow(iso));
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ms(s));

export type RenoCalendarMode = "month" | "week";

export interface RenoWindow {
  mode: RenoCalendarMode;
  /** YYYY-MM of the month shown (month view) or of the week's first day */
  month: string;
  /** Sunday of the week shown (week view) */
  weekStart: string;
  /** Sunday-first weeks of seven ISO days */
  weeks: string[][];
  from: string;
  to: string;
  label: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** The month (`month` YYYY-MM) or week (`week`, any day of it) to show; today's when missing or invalid. */
export function renoWindow(mode: RenoCalendarMode, month: string, week: string, today: string): RenoWindow {
  if (mode === "week") {
    const weekStart = sundayOf(isIso(week) ? week : today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const last = days[6]!;
    const [y1, m1, d1] = weekStart.split("-").map(Number) as [number, number, number];
    const [y2, m2, d2] = last.split("-").map(Number) as [number, number, number];
    const label = y1 !== y2
      ? `${d1} ${SHORT_MONTHS[m1 - 1]} ${y1} – ${d2} ${SHORT_MONTHS[m2 - 1]} ${y2}`
      : m1 !== m2
        ? `${d1} ${SHORT_MONTHS[m1 - 1]} – ${d2} ${SHORT_MONTHS[m2 - 1]} ${y2}`
        : `${d1} – ${d2} ${SHORT_MONTHS[m2 - 1]} ${y2}`;
    return { mode, month: weekStart.slice(0, 7), weekStart, weeks: [days], from: weekStart, to: last, label };
  }
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7);
  const first = `${ym}-01`;
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const lastOfMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const start = sundayOf(first);
  const weeks: string[][] = [];
  for (let s = start; s <= lastOfMonth; s = addDays(s, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(s, i)));
  return { mode, month: ym, weekStart: sundayOf(isIso(week) ? week : first), weeks, from: start, to: weeks[weeks.length - 1]![6]!, label: `${MONTHS[m - 1]} ${y}` };
}

/** The window one step back (-1) or forward (+1) as URL values. */
export function stepWindow(w: RenoWindow, dir: -1 | 1): { month: string; week: string } {
  if (w.mode === "week") {
    const week = addDays(w.weekStart, 7 * dir);
    return { month: week.slice(0, 7), week };
  }
  const [y, m] = w.month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
  return { month: d.slice(0, 7), week: sundayOf(d) };
}

/** URL values that show a given day in either view. */
export const jumpTo = (iso: string): { month: string; week: string } => ({ month: iso.slice(0, 7), week: sundayOf(iso) });

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS = DOW;
/** "Thu 8 Oct" */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${DOW[dow(iso)]} ${d} ${SHORT_MONTHS[m - 1]}`;
}
/** "8 Oct", or "8 – 12 Oct", "28 Sep – 2 Oct" for a span. */
export function spanLabel(i: Pick<RenoCalendarItem, "date" | "end">): string {
  const s = i.date;
  const e = itemEnd(i);
  const [, m1, d1] = s.split("-").map(Number) as [number, number, number];
  const [, m2, d2] = e.split("-").map(Number) as [number, number, number];
  if (s === e) return `${d1} ${SHORT_MONTHS[m1 - 1]}`;
  return m1 === m2 ? `${d1} – ${d2} ${SHORT_MONTHS[m2 - 1]}` : `${d1} ${SHORT_MONTHS[m1 - 1]} – ${d2} ${SHORT_MONTHS[m2 - 1]}`;
}

// ── Week lanes ────────────────────────────────────────────────

export interface WeekSegment {
  item: RenoCalendarItem;
  startCol: number;
  endCol: number;
  /** the item started before / goes on after this week */
  clipLeft: boolean;
  clipRight: boolean;
  lane: number;
}

export interface WeekLayout {
  segments: WeekSegment[];
  lanes: number;
  /** per day column: how many items sit in lanes at or past `maxLanes` */
  hidden: number[];
}

/** Cards of one week: one segment per item spanning its days in the week, packed into lanes top-down (longer
    and earlier items first, then the order given). Lanes from `maxLanes` on are counted per day, not drawn. */
export function layoutWeek(items: readonly RenoCalendarItem[], week: readonly string[], maxLanes = Infinity): WeekLayout {
  const first = week[0]!;
  const last = week[week.length - 1]!;
  const segs: WeekSegment[] = [];
  items.forEach((item) => {
    const e = itemEnd(item);
    if (e < first || item.date > last) return;
    const clipLeft = item.date < first;
    const clipRight = e > last;
    segs.push({
      item, clipLeft, clipRight, lane: 0,
      startCol: clipLeft ? 0 : daysBetween(first, item.date),
      endCol: clipRight ? week.length - 1 : daysBetween(first, e),
    });
  });
  const order = new Map(items.map((i, n) => [i.key, n] as const));
  segs.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || order.get(a.item.key)! - order.get(b.item.key)!);
  const lanes: WeekSegment[][] = [];
  for (const s of segs) {
    let lane = lanes.findIndex((l) => l.every((o) => o.endCol < s.startCol || o.startCol > s.endCol));
    if (lane === -1) {
      lanes.push([]);
      lane = lanes.length - 1;
    }
    lanes[lane]!.push(s);
    s.lane = lane;
  }
  const hidden = Array<number>(week.length).fill(0);
  const shown: WeekSegment[] = [];
  for (const s of segs) {
    if (s.lane < maxLanes) shown.push(s);
    else for (let c = s.startCol; c <= s.endCol; c++) hidden[c]! += 1;
  }
  return { segments: shown, lanes: Math.min(lanes.length, maxLanes), hidden };
}
