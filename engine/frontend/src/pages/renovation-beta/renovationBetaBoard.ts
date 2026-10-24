/* The Beta Home and Calendar logic, ported from the owner's mockup (app.js: status, stage, rounds, items,
   apptItems, nextFor, renderHome, renderDeadlines, renderProg, renderCal and the form defaults) and fed with the
   server's BetaBoard instead of its sample data. Pure: nothing here reads the clock; today comes from the board.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import type {
  BetaBoard, BetaBoardAppointment, BetaBoardProject, BetaBoardRef, BoardRange, DesignKind,
} from "./renovationBetaBoardApi";

export type Kind = "3" | "2";
export type ApptKey = "msr" | "cm" | "sb";
export type StepKey = "msr" | Kind | "cm" | "sb" | "po";
export type Letter = "A" | "B" | "C" | "D" | "E";
/** The person whose work is shown: one person's id, or the whole team. */
export type Viewing = number | "All";

export interface PersonRef { id: number; name: string }

/** A person as the pickers and chips show them: the project page's label parts and whether they may be picked now. */
export interface BoardPerson extends PersonRef { position: string | null; department: string | null; offered: boolean }

export interface Amendment { id: number; s: string; days: number; done: string | null }

export interface DesignTrack {
  s: string | null;
  done: string | null;
  ok: boolean;
  am: Amendment[];
}

export interface Appt { d: string; t: string; who: PersonRef | null; with: string | null; done: boolean }

export interface DesignProject {
  id: number;
  code: string | null;
  /** Building and unit, as the mockup's first name part. */
  title: string;
  customer: string | null;
  salesName: string | null;
  createdOn: string | null;
  /** Title and customer joined with the mockup's separator. */
  name: string;
  tag: string;
  lead: PersonRef | null;
  /** Who draws each kind, as one name for the rows that show one ("Ali, Siti"); the id is the first person's. */
  by: Record<Kind, PersonRef | null>;
  /** Everyone drawing each kind, in the order picked; the design lead when nobody is picked. */
  team: Record<Kind, PersonRef[]>;
  site: PersonRef | null;
  unassigned: boolean;
  handover: string | null;
  measuredOn: string | null;
  design: Record<Kind, DesignTrack>;
  po: string | null;
  appts: Partial<Record<ApptKey, Appt>>;
  /** Null when the person may not see money (the Payment column is then left out). */
  payment: string | null;
  /** Money still owed on the sales order; null when there is none or money is hidden. */
  outstandingSen: number | null;
}

export type EventGroup = "upd" | "meet" | "work";

export interface CalEvent {
  /** "e<id>" for a stored event, "ap|<project>|<key>" for a booked appointment. */
  id: string;
  d: string;
  t: string;
  type: string;
  note: string;
  who: PersonRef | null;
  projectId: number | null;
  done: boolean;
  eventId: number | null;
  appt: { projectId: number; key: ApptKey } | null;
}

export interface BoardModel {
  today: string;
  mePersonId: number | null;
  sop: Record<Kind, number>;
  amd: number;
  /** The people offered for picking and for the calendar's person filter (the project page's rule). */
  people: PersonRef[];
  /** Every person of the company, with label parts, for names on old records and the pickers' current picks. */
  everyone: BoardPerson[];
  projects: DesignProject[];
  byId: ReadonlyMap<number, DesignProject>;
  events: CalEvent[];
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS: readonly string[] = MON;

/* ---------- dates ---------- */

export function add(s: string, n: number): string {
  return new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

export function diff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

/** "23 Oct". */
export function ds(s: string): string {
  const [, m, d] = s.split("-");
  return `${Number(d)} ${MS[Number(m) - 1] ?? ""}`;
}

export function ord(n: number): string {
  return n + (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");
}

export function dayWord(n: number): string {
  return n === 1 ? "day" : "days";
}

/** The two letters on a person's badge: "Jia Xin" gives JX, "Alex" gives AL. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export const mine = (who: Viewing, id: number | null | undefined): boolean => who === "All" || (id != null && id === who);

/** Whether the viewer is one of these people (or the whole team is viewed). */
export const mineAny = (who: Viewing, people: readonly PersonRef[]): boolean => who === "All" || people.some((x) => x.id === who);

/** Several people as one reference: the names joined ("Ali, Siti"), the first person's id. */
export function joinedRef(people: readonly PersonRef[]): PersonRef | null {
  return people.length === 0 ? null : { id: people[0].id, name: people.map((x) => x.name).join(", ") };
}

/** "Position · Department" of a person, empty when neither is known. */
export function personInfo(p: Pick<BoardPerson, "position" | "department"> | undefined): string {
  return p ? [p.position, p.department].map((v) => (v ?? "").trim()).filter(Boolean).join(" · ") : "";
}

/* ---------- the mockup's labels ---------- */

export const SOP_LABEL = (m: Pick<BoardModel, "sop">): string => `Deadlines follow the ID SOP: 3D in ${m.sop["3"]} days, 2D in ${m.sop["2"]} days`;

export const APPT_KEYS: readonly ApptKey[] = ["msr", "cm", "sb"];
export const APPT_LABEL: Readonly<Record<ApptKey, string>> = { msr: "Site measurement", cm: "Carpentry measure", sb: "Site briefing" };
export const APPT_TYPE: Readonly<Record<ApptKey, string>> = { msr: "measure", cm: "measure", sb: "briefing" };
const APPT_KIND: Readonly<Record<ApptKey, BetaBoardAppointment["kind"]>> = { msr: "site_measure", cm: "carpentry_measure", sb: "site_briefing" };
export const apptKindOf = (key: ApptKey): BetaBoardAppointment["kind"] => APPT_KIND[key];

export const EVENT_TYPES = [
  ["update", "Drawing update"], ["client", "Client meeting"], ["measure", "Site measurement"], ["briefing", "Site briefing"],
  ["meeting", "Internal meeting"], ["w3d", "3D"], ["w2d", "2D"], ["amend", "Amendment"], ["po", "PO / C.PO"],
] as const;
export type EventTypeKey = (typeof EVENT_TYPES)[number][0];
const TYPE_LABEL: Readonly<Record<string, string>> = Object.fromEntries(EVENT_TYPES);
export const typeLabel = (type: string): string => TYPE_LABEL[type] ?? type;
const GROUP: Readonly<Record<string, EventGroup>> = {
  update: "upd", client: "meet", measure: "meet", briefing: "meet", meeting: "meet", w3d: "work", w2d: "work", amend: "work", po: "work",
};
export const groupOf = (type: string): EventGroup => GROUP[type] ?? "work";

export function isEventType(v: string): v is EventTypeKey {
  return EVENT_TYPES.some(([k]) => k === v);
}

/* ---------- the board turned into the mockup's project shape ---------- */

/** The mockup's name trick, kept as the fallback when a project has no building: drop trailing unit-like words. */
function buildingFromTitle(title: string): string {
  const w = title.split(" ");
  while (w.length > 1 && /\d/.test(w[w.length - 1])) w.pop();
  return w.join(" ");
}

function ref(r: BetaBoardRef | null): PersonRef | null {
  return r ? { id: r.id, name: r.name } : null;
}

function track(p: BetaBoardProject, k: DesignKind, defaultDays: number, approval3d: string | null): DesignTrack {
  const files = p.files.filter((f) => f.kind === k).sort((a, b) => a.version - b.version);
  const first = files[0];
  const newest = files[files.length - 1];
  const notes = p.notes.filter((n) => n.kind === k).sort((a, b) => a.notedOn.localeCompare(b.notedOn) || a.id - b.id);
  const reviewOf = (fileId: number): string | null => p.reviews.find((r) => r.fileId === fileId)?.approvedOn ?? null;
  const explicit = k === "3d" ? p.start3dOn : p.start2dOn;
  /* A 3D file with nothing recorded starts at the site measure; a 2D one at the 3D approval. */
  const fallback = k === "3d" ? p.measuredOn : approval3d;
  const s = explicit ?? (first ? fallback ?? first.submittedOn : null);
  /* The server closes only 2D notes. A round is answered when its note is closed, or when a later version was submitted
     on or after the note's day; each later version answers one round, in order. */
  const later = files.slice(1);
  const used = new Set<number>();
  const am: Amendment[] = notes.map((n) => {
    const answer = n.closedOn == null ? later.find((f) => !used.has(f.id) && f.submittedOn >= n.notedOn) : undefined;
    if (answer) used.add(answer.id);
    return { id: n.id, s: n.notedOn, days: n.days ?? defaultDays, done: n.closedOn ?? answer?.submittedOn ?? null };
  });
  /* Approved means the newest version is approved and every amendment is answered; a new amendment re-opens the stage. */
  const ok = !!newest && reviewOf(newest.id) != null && am.every((a) => a.done != null);
  return { s, done: first ? first.submittedOn : null, ok, am };
}

function paymentText(p: BetaBoardProject): string | null {
  if (p.payment.state === "hidden") return null;
  return p.payment.state === "none" ? "No SO yet" : p.payment.label;
}

/** The mockup's shape for every project, with real people ids. `site` can be null: it is then shown as "Site PIC" with no name. */
export function toBoardProjects(board: BetaBoard): DesignProject[] {
  const people = new Map(board.people.map((x) => [x.id, { id: x.id, name: x.name }] as const));
  const amd = board.settings.amendmentDays;
  return board.projects.map((p) => {
    const title = [p.building, p.unitNo].filter((x): x is string => !!x && x.trim() !== "").join(" ") || p.name;
    const customer = p.customerName?.trim() || null;
    const lead = ref(p.lead);
    const team = (list: BetaBoardRef[] | undefined, one: BetaBoardRef | null): PersonRef[] => {
      const picked = list ?? (one ? [one] : []);
      return picked.length ? picked.map((x) => ({ id: x.id, name: x.name })) : lead ? [lead] : [];
    };
    const t3 = team(p.people3d, p.person3d);
    const t2 = team(p.people2d, p.person2d);
    const d3 = track(p, "3d", amd, null);
    const approval3d = (() => {
      const newest3 = p.files.filter((f) => f.kind === "3d").sort((a, b) => b.version - a.version)[0];
      return newest3 ? p.reviews.find((r) => r.fileId === newest3.id)?.approvedOn ?? null : null;
    })();
    const d2 = track(p, "2d", amd, approval3d);
    const appts: Partial<Record<ApptKey, Appt>> = {};
    for (const key of APPT_KEYS) {
      const a = p.appointments.find((x) => x.kind === APPT_KIND[key]);
      if (a) appts[key] = { d: a.onDate, t: a.atTime?.slice(0, 5) ?? "", who: a.personId == null ? null : people.get(a.personId) ?? null, with: a.withText, done: a.doneAt != null };
    }
    return {
      id: p.id,
      code: p.code,
      title,
      customer,
      salesName: p.salesName,
      createdOn: p.createdOn,
      name: customer ? `${title} · ${customer}` : title,
      tag: p.building?.trim() || buildingFromTitle(title),
      lead,
      by: { "3": joinedRef(t3), "2": joinedRef(t2) },
      team: { "3": t3, "2": t2 },
      site: ref(p.sitePic),
      unassigned: lead == null,
      handover: p.handoverOn,
      measuredOn: p.measuredOn,
      design: { "3": d3, "2": d2 },
      po: p.poDoneOn,
      appts,
      payment: paymentText(p),
      outstandingSen: p.payment.state === "ok" ? p.payment.outstandingSen ?? null : null,
    };
  });
}

export function buildModel(board: BetaBoard): BoardModel {
  const projects = toBoardProjects(board);
  const byId = new Map(projects.map((p) => [p.id, p] as const));
  const everyone: BoardPerson[] = board.people.map((x) => ({
    id: x.id, name: x.name, position: x.position ?? null, department: x.department ?? null, offered: x.offered ?? true,
  }));
  const people = everyone.filter((x) => x.offered).map((x) => ({ id: x.id, name: x.name }));
  const person = new Map(everyone.map((x) => [x.id, { id: x.id, name: x.name }] as const));
  const events: CalEvent[] = board.events.map((e) => ({
    id: `e${e.id}`, d: e.onDate, t: e.atTime?.slice(0, 5) ?? "", type: e.type, note: e.note ?? "",
    who: e.personId == null ? null : person.get(e.personId) ?? null, projectId: e.projectId, done: e.done, eventId: e.id, appt: null,
  }));
  return {
    today: board.today,
    mePersonId: board.mePersonId,
    sop: { "3": board.settings.design3dDays, "2": board.settings.design2dDays },
    amd: board.settings.amendmentDays,
    people,
    everyone,
    projects,
    byId,
    events,
  };
}

/* ---------- design stages, appointments, status ---------- */

export interface Round { s: string; days: number; done: string | null; n: number }

/** One stage = the first submission plus any amendment rounds; each round has its own deadline. */
export function rounds(m: BoardModel, p: DesignProject, k: Kind): Round[] {
  const t = p.design[k];
  if (!t.s) return [];
  return [{ s: t.s, days: m.sop[k], done: t.done, n: 0 }, ...t.am.map((a, i) => ({ s: a.s, days: a.days, done: a.done, n: i + 1 }))];
}

export type Stage =
  | { st: "none" }
  | { st: "ok"; rs: Round[] }
  | { st: "work"; rs: Round[]; r: Round; due: string }
  | { st: "wait"; rs: Round[]; r: Round };

export function stage(m: BoardModel, p: DesignProject, k: Kind): Stage {
  const rs = rounds(m, p, k);
  if (rs.length === 0) return { st: "none" };
  const r = rs[rs.length - 1];
  if (p.design[k].ok) return { st: "ok", rs };
  if (!r.done) return { st: "work", rs, r, due: add(r.s, r.days) };
  return { st: "wait", rs, r };
}

/** An appointment counts as done once its date has passed. */
export function adone(m: BoardModel, a: Appt | undefined): boolean {
  return !!a && (a.done || a.d < m.today);
}

export function measured(m: BoardModel, p: DesignProject): boolean {
  return !!p.measuredOn || adone(m, p.appts.msr) || !!p.design["3"].s;
}

/** Who does an appointment: the person on it, else the design lead. */
export const apptWho = (p: DesignProject, a: Appt): PersonRef | null => a.who ?? p.lead;

/** The "with" text the mockup fills in for each appointment. */
export function apptWithDefault(p: DesignProject, key: ApptKey): string {
  return key === "msr" ? "Client" : key === "cm" ? "Carpenter" : p.site?.name ?? "Site PIC";
}

export const STEPS: ReadonlyArray<readonly [StepKey, string]> = [
  ["msr", "Measure"], ["3", "3D"], ["2", "2D"], ["cm", "Carpentry"], ["sb", "Site PIC"], ["po", "PO"],
];

export function stepDone(m: BoardModel, p: DesignProject, k: StepKey): boolean {
  if (k === "msr") return measured(m, p);
  if (k === "3" || k === "2") return p.design[k].ok;
  if (k === "po") return !!p.po;
  return adone(m, p.appts[k]);
}

export function status(m: BoardModel, p: DesignProject): readonly [Letter, string] {
  if (p.unassigned) return ["A", "New · team not assigned"];
  if (!measured(m, p)) return ["A", p.appts.msr?.d ? "Site measure booked" : "Pending site measure"];
  const g3 = stage(m, p, "3");
  if (g3.st !== "ok") return ["B", g3.st === "none" ? "Pending 3D design" : g3.st === "wait" ? "3D sent · waiting client" : g3.r.n ? "3D amendment" : "3D in progress"];
  const g2 = stage(m, p, "2");
  if (g2.st !== "ok") return ["C", g2.st === "none" ? "Pending 2D" : g2.st === "wait" ? "2D sent · waiting client" : g2.r.n ? "2D amendment" : "2D in progress"];
  if (!adone(m, p.appts.cm)) return ["D", p.appts.cm?.d ? "Carpentry measure booked" : "Pending carpentry measure"];
  if (!adone(m, p.appts.sb)) return ["D", p.appts.sb?.d ? "Site briefing booked" : "Pending site briefing"];
  if (!p.po) return ["D", "Pending PO"];
  return ["E", "Done all design"];
}

/** The condition pill's words, "B - 3D amendment". */
export const conditionText = (m: BoardModel, p: DesignProject): string => {
  const [letter, words] = status(m, p);
  return `${letter} - ${words}`;
};

/* ---------- deadlines ---------- */

export interface DueItem {
  type: "due";
  p: DesignProject;
  k: Kind | "h";
  n: number;
  what: string;
  due: string;
  from?: string;
  days?: number;
  by: PersonRef | null;
}

export interface ApptItem { type: "appt"; p: DesignProject; ak: ApptKey; a: Appt; due: string; by: PersonRef | null }

export function items(m: BoardModel, who: Viewing): DueItem[] {
  const out: DueItem[] = [];
  for (const p of m.projects) {
    for (const k of ["3", "2"] as const) {
      const g = stage(m, p, k);
      if (g.st !== "work" || !mineAny(who, p.team[k])) continue;
      out.push({
        type: "due", p, k, n: g.r.n, what: g.r.n ? `${k}D ${ord(g.r.n)} amendment` : `${k}D deadline`,
        due: g.due, from: g.r.s, days: g.r.days, by: p.by[k],
      });
    }
    if (p.handover && p.handover >= m.today && mine(who, p.site?.id)) {
      out.push({ type: "due", p, k: "h", n: 0, what: "Handover", due: p.handover, by: p.site });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

export function apptItems(m: BoardModel, who: Viewing): ApptItem[] {
  const out: ApptItem[] = [];
  for (const p of m.projects) {
    for (const ak of APPT_KEYS) {
      const a = p.appts[ak];
      if (!a || adone(m, a) || !mine(who, apptWho(p, a)?.id)) continue;
      out.push({ type: "appt", p, ak, a, due: a.d, by: apptWho(p, a) });
    }
  }
  return out;
}

export interface WaitItem { p: DesignProject; k: Kind; n: number; sent: string }
export interface ReadyItem { p: DesignProject; k: Kind }
export type TodoKind = "as" | ApptKey | "po";
export interface TodoItem { p: DesignProject; k: TodoKind }

export interface DeadlineGroups {
  late: Array<DueItem | ApptItem>;
  week: Array<DueItem | ApptItem>;
  two: Array<DueItem | ApptItem>;
  later: Array<DueItem | ApptItem>;
  waiting: WaitItem[];
  ready: ReadyItem[];
  todo: TodoItem[];
}

const sortKey = (x: DueItem | ApptItem): string => x.due + (x.type === "appt" ? x.a.t : "");

export function deadlineGroups(m: BoardModel, who: Viewing, canAssign: boolean): DeadlineGroups {
  const all = [...items(m, who), ...apptItems(m, who)].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const g: DeadlineGroups = { late: [], week: [], two: [], later: [], waiting: [], ready: [], todo: [] };
  for (const x of all) {
    const l = diff(x.due, m.today);
    (l < 0 ? g.late : l <= 7 ? g.week : l <= 14 ? g.two : g.later).push(x);
  }
  for (const p of m.projects) {
    for (const k of ["3", "2"] as const) {
      const s = stage(m, p, k);
      if (s.st === "wait" && mineAny(who, p.team[k]) && s.r.done) g.waiting.push({ p, k, n: s.r.n, sent: s.r.done });
    }
    if (!p.unassigned && !p.design["3"].s && measured(m, p) && mineAny(who, p.team["3"])) g.ready.push({ p, k: "3" });
    else if (p.design["3"].ok && !p.design["2"].s && mineAny(who, p.team["2"])) g.ready.push({ p, k: "2" });
  }
  for (const p of m.projects) {
    /* A project with no design lead yet is shown to the whole team and to anyone who can assign. */
    if (p.unassigned) {
      if (who === "All" || canAssign) g.todo.push({ p, k: "as" });
      continue;
    }
    if (!mine(who, p.lead?.id)) continue;
    if (!measured(m, p) && !p.appts.msr?.d) g.todo.push({ p, k: "msr" });
    if (p.design["2"].ok) {
      if (!p.appts.cm?.d) g.todo.push({ p, k: "cm" });
      else if (!p.appts.sb?.d) g.todo.push({ p, k: "sb" });
      if (!p.po) g.todo.push({ p, k: "po" });
    }
  }
  return g;
}

/** Days-left words on a deadline row: "2 days late", "Due today", "3 days left". */
export function leftText(l: number): string {
  return l < 0 ? `${-l} ${dayWord(-l)} late` : l === 0 ? "Due today" : `${l} ${l === 1 ? "day" : "days"} left`;
}

/** The appointment row's pill: "Today", "In 3 days", or late. */
export function apptLeftText(l: number): string {
  return l < 0 ? `${-l} ${dayWord(-l)} late` : l === 0 ? "Today" : `In ${l} ${dayWord(l)}`;
}

/** The short form the Home table and cards use: "3d late", "Today", "5d left". */
export function shortLeft(l: number): string {
  return l < 0 ? `${-l}d late` : l === 0 ? "Today" : `${l}d left`;
}

/** The wording of one to-do row ("To book / to do"). */
export function todoText(m: BoardModel, x: TodoItem): string {
  if (x.k === "po") return "Fill in PO · done by itself once sent to the client";
  if (x.k === "as") return "New project · choose who does 3D, 2D and site";
  const base = `Book ${APPT_LABEL[x.k].toLowerCase()} · with ${apptWithDefault(x.p, x.k)}`;
  const cm = x.p.appts.cm?.d;
  return x.k === "sb" && cm ? `${base} · after carpentry measure on ${ds(cm)}` : base;
}

/* ---------- Home ---------- */

export interface Next { t: string; d: string | null; by: PersonRef | null }

export function nextFor(m: BoardModel, p: DesignProject): Next | null {
  let best: Next | null = null;
  for (const k of ["3", "2"] as const) {
    const g = stage(m, p, k);
    if (g.st !== "work") continue;
    const it: Next = { t: `${g.r.n ? `${k}D ${ord(g.r.n)} amendment` : `${k}D`} due`, d: g.due, by: p.by[k] };
    if (!best || (it.d ?? "") < (best.d ?? "")) best = it;
  }
  if (!best) {
    for (const ak of APPT_KEYS) {
      const a = p.appts[ak];
      if (!a?.d || adone(m, a)) continue;
      const it: Next = { t: APPT_LABEL[ak], d: a.d, by: apptWho(p, a) };
      if (!best || (it.d ?? "") < (best.d ?? "")) best = it;
    }
  }
  if (!best) {
    const w = (["3", "2"] as const).filter((k) => stage(m, p, k).st === "wait").map((k) => `${k}D`);
    if (w.length) best = { t: `${w.join(" & ")} waiting for client`, d: null, by: null };
  }
  return best;
}

export type HomeTab = "all" | "A" | "BC" | "D" | "E";
export const HOME_TABS: ReadonlyArray<readonly [HomeTab, string]> = [
  ["all", "All projects"], ["A", "Site Measure"], ["BC", "Design"], ["D", "Carpentry · Site · PO"], ["E", "Done Design"],
];

export function inTab(m: BoardModel, p: DesignProject, t: HomeTab): boolean {
  return t === "all" || t.includes(status(m, p)[0]);
}

export function homeCounts(m: BoardModel): { late: number; week: number; tabs: Record<HomeTab, number> } {
  let late = 0;
  let week = 0;
  for (const p of m.projects) {
    const nx = nextFor(m, p);
    if (!nx?.d) continue;
    const l = diff(nx.d, m.today);
    if (l < 0) late++;
    else if (l <= 7) week++;
  }
  const tabs: Record<HomeTab, number> = { all: 0, A: 0, BC: 0, D: 0, E: 0 };
  for (const [t] of HOME_TABS) tabs[t] = m.projects.filter((p) => inTab(m, p, t)).length;
  return { late, week, tabs };
}

/** The tab's projects: projects with no team first, then the soonest next deadline, none last. */
export function homeList(m: BoardModel, t: HomeTab): DesignProject[] {
  return m.projects.filter((p) => inTab(m, p, t)).sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? -1 : 1;
    return (nextFor(m, a)?.d ?? "9999").localeCompare(nextFor(m, b)?.d ?? "9999");
  });
}

export interface HomeRow {
  p: DesignProject;
  cond: string;
  /** The condition letter (A to E) and its words, apart, for the status cell. */
  letter: Letter;
  tone: string;
  /** Who now: "assign" when the team is empty and the viewer may assign, "needs" when they may not, else a name. */
  whoNow: { kind: "assign" } | { kind: "needs" } | { kind: "name"; name: string };
  left: number | null;
}

export function homeRow(m: BoardModel, p: DesignProject, canAssign: boolean): HomeRow {
  const nx = nextFor(m, p);
  const [letter, words] = status(m, p);
  return {
    p,
    cond: conditionText(m, p),
    letter,
    tone: words,
    whoNow: p.unassigned ? (canAssign ? { kind: "assign" } : { kind: "needs" }) : { kind: "name", name: nx?.by?.name ?? p.by["3"]?.name ?? "" },
    left: nx?.d ? diff(nx.d, m.today) : null,
  };
}

/* ---------- Progress ---------- */

export function progressList(m: BoardModel, who: Viewing): DesignProject[] {
  return m.projects
    .filter((p) => mine(who, p.lead?.id) || mineAny(who, p.team["3"]) || mineAny(who, p.team["2"]) || mine(who, p.site?.id))
    .sort((a, b) => currentStep(m, a) - currentStep(m, b));
}

/** The index of the step the project is on now, or 99 when every step is done. */
export function currentStep(m: BoardModel, p: DesignProject): number {
  const i = STEPS.findIndex(([k]) => !stepDone(m, p, k));
  return i < 0 ? 99 : i;
}

/* ---------- Calendar ---------- */

export function dueOn(m: BoardModel, who: Viewing, day: string): DueItem[] {
  return items(m, who).filter((x) => x.due === day);
}

export function apptEvents(m: BoardModel): CalEvent[] {
  const out: CalEvent[] = [];
  for (const p of m.projects) {
    for (const key of APPT_KEYS) {
      const a = p.appts[key];
      if (!a?.d) continue;
      out.push({
        id: `ap|${p.id}|${key}`, d: a.d, t: a.t, type: APPT_TYPE[key], note: `${APPT_LABEL[key]} · ${a.with || apptWithDefault(p, key)}`,
        who: apptWho(p, a), projectId: p.id, done: adone(m, a), eventId: null, appt: { projectId: p.id, key },
      });
    }
  }
  return out;
}

export const allEvents = (m: BoardModel): CalEvent[] => [...m.events, ...apptEvents(m)];

const timeKey = (t: string): string => t || "99";

export function eventsOn(m: BoardModel, who: Viewing, day: string): CalEvent[] {
  return allEvents(m).filter((e) => e.d === day && mine(who, e.who?.id)).sort((a, b) => timeKey(a.t).localeCompare(timeKey(b.t)));
}

/** The side list: the picked day's events, or the next eight that are not done. */
export function listFor(m: BoardModel, who: Viewing, selDay: string | null): { title: string; due: DueItem[]; events: CalEvent[] } {
  if (selDay) {
    return {
      title: ds(selDay) + (selDay === m.today ? " · today" : ""),
      due: dueOn(m, who, selDay),
      events: allEvents(m).filter((e) => e.d === selDay && mine(who, e.who?.id)).sort((a, b) => (a.d + timeKey(a.t)).localeCompare(b.d + timeKey(b.t))),
    };
  }
  const events = allEvents(m)
    .filter((e) => e.d >= m.today && mine(who, e.who?.id) && !e.done)
    .sort((a, b) => (a.d + timeKey(a.t)).localeCompare(b.d + timeKey(b.t)))
    .slice(0, 8);
  return { title: "Coming up", due: [], events };
}

/** Month cells, Monday first: null for the blanks around the month. */
export function monthCells(year: number, month0: number): Array<number | null> {
  const off = (new Date(Date.UTC(year, month0, 1)).getUTCDay() + 6) % 7;
  const n = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: Array<number | null> = Array.from({ length: off }, () => null);
  for (let i = 1; i <= n; i++) cells.push(i);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export const dayKey = (year: number, month0: number, d: number): string =>
  `${year}-${String(month0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** A month before January or after December moves to the next year. */
export function shiftMonth(year: number, month0: number, by: number): { y: number; m: number } {
  const t = year * 12 + month0 + by;
  return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}

const DEFAULT_BACK = 60;
const DEFAULT_AHEAD = 180;
const MAX_SPAN = 400;

/** What the board query asks for: nothing (the server's window) while the month is inside it, else a window that covers the month. */
export function rangeFor(today: string, year: number, month0: number): BoardRange | undefined {
  const first = dayKey(year, month0, 1);
  const last = dayKey(year, month0, new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate());
  const from = add(today, -DEFAULT_BACK);
  const to = add(today, DEFAULT_AHEAD);
  if (first >= from && last <= to) return undefined;
  const wide: BoardRange = { from: first < from ? first : from, to: last > to ? last : to };
  return diff(wide.to, wide.from) + 1 <= MAX_SPAN ? wide : { from: first, to: last };
}

/* ---------- form defaults and checks ---------- */

/** The new deadline an amendment gives: "New deadline: 26 Oct". */
export function amendDue(startOn: string, days: number): string | null {
  return startOn && Number.isFinite(days) ? add(startOn, days) : null;
}

/** The "3D deadline / 2D deadline" lines under the project dates form. */
export function dateHints(m: BoardModel, p: DesignProject, s3: string, s2: string): string[] {
  return (["3", "2"] as const).map((k) => {
    const v = k === "3" ? s3 : s2;
    const am = p.design[k].am;
    const last = am[am.length - 1];
    return `${k}D deadline: ${v ? ds(add(v, m.sop[k])) : "–"}${am.length ? ` · then ${am.length} ${am.length > 1 ? "amendments" : "amendment"} (latest due ${ds(add(last.s, last.days))})` : ""}`;
  });
}

/** A site briefing must come after the carpentry measure. Null when the date is fine. */
export function bookIssue(p: DesignProject, key: ApptKey, onDate: string): string | null {
  const cm = p.appts.cm?.d;
  return key === "sb" && cm && onDate <= cm ? `Site briefing must be after the carpentry measure (${ds(cm)})` : null;
}

/** The kind the server expects for a stage. */
export const designKind = (k: Kind): DesignKind => (k === "3" ? "3d" : "2d");

/** One project as the mockup sees it, from a board answer (the workspace asks the board for just its project). */
export function projectView(board: BetaBoard, projectId: number): { m: BoardModel; p: DesignProject } | null {
  const m = buildModel(board);
  const p = m.byId.get(projectId);
  return p ? { m, p } : null;
}
