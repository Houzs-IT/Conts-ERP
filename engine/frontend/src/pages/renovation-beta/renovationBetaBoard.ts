/* The Beta Home and Calendar logic, ported from the owner's mockup (app.js: status, stage, rounds, items,
   apptItems, nextFor, renderHome, renderDeadlines, renderProg, renderCal and the form defaults) and fed with the
   server's BetaBoard instead of its sample data. Pure: nothing here reads the clock; today comes from the board.
   Plan: docs/superpowers/plans/2026-10-23-beta-project-workspace.md, section 10. */

import { fmtDayMonth } from "../../vendor/shared/format";
import type {
  BetaBoard, BetaBoardAppointment, BetaBoardPerson, BetaBoardProject, BetaBoardRef, BoardRange, DesignKind, BetaWorkType,
} from "./renovationBetaBoardApi";

export type Kind = "3" | "2";
export type ApptKey = "msr" | "cm" | "sb";
/** A sales order line still waiting for a required variant: its SKU and the variant fields left to pick. */
export interface VariantPending {
  itemCode: string;
  missing: string[];
  /** The SO line and what its picker needs; absent from an older server. */
  id?: string;
  docNo?: string | null;
  description?: string | null;
  category?: string;
  variants?: Record<string, unknown>;
}

/** A Design step: the code of a work of the list in Project Maintenance, or "variants" (checked by the system). */
export type StepKey = string;
export type Letter = "A" | "B" | "C" | "D" | "E";
/** The person whose work is shown: one person's id, or the whole team. */
export type Viewing = number | "All";

export interface PersonRef { id: number; name: string }

/** A person as the pickers and chips show them: the project page's label parts and whether they may be picked now. */
export interface BoardPerson extends PersonRef { position: string | null; department: string | null; offered: boolean; managerPersonId: number | null }

export interface Amendment { id: number; s: string; days: number; done: string | null }

export interface DesignTrack {
  s: string | null;
  done: string | null;
  ok: boolean;
  am: Amendment[];
}

/** who is the first of people, for screens that show one name. */
export interface Appt { d: string; t: string; who: PersonRef | null; people: PersonRef[]; whoText?: string | null; with: string | null; done: boolean }

export interface DesignProject {
  id: number;
  code: string | null;
  /** Building and unit, as the mockup's first name part. */
  title: string;
  customer: string | null;
  /** The brand it is sold under, as picked on Client & team; null when none is picked yet. */
  brand: string | null;
  salesName: string | null;
  createdOn: string | null;
  /** When it was made (ISO), for "newest first"; falls back to the day. */
  createdAt: string | null;
  /** Building, unit and sales order numbers, for the list's search. */
  building: string | null;
  unitNo: string | null;
  soDocNos: string[];
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
  /** The day it was handed over to the client; null while it is still running. */
  handedOver: string | null;
  measuredOn: string | null;
  design: Record<Kind, DesignTrack>;
  po: string | null;
  appts: Partial<Record<ApptKey, Appt>>;
  /** Null when the person may not see money (the Payment column is then left out). */
  payment: string | null;
  /** Instalments fully received; null when finance is hidden or there is no contract. */
  paid: number | null;
  /** The newest booking of each work of the list, by its code. */
  works: Record<string, { d: string; t: string; done: boolean }>;
  /** Sales order lines and how many still miss a required variant. */
  variants: { lines: number; missing: number; pending: VariantPending[] };
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
  /** The first of people. */
  who: PersonRef | null;
  /** Everyone going (owner, 22 Nov 2026): the booking is on each one's own calendar. */
  people: PersonRef[];
  /** A typed name for someone not on the list, shown as text and on nobody's calendar (owner, 20 Nov 2026). */
  whoText?: string | null;
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
  /** The works of the list in Project Maintenance, in order (the old fixed list on an older server). */
  workTypes: BetaWorkType[];
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const MONTHS: readonly string[] = MON;

/* ---------- dates ---------- */

export function add(s: string, n: number): string {
  return new Date(Date.parse(`${s}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

export function diff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);
}

/** "23/10": the app's short date, day first. */
export function ds(s: string): string {
  return fmtDayMonth(s);
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
export const APPT_LABEL: Readonly<Record<ApptKey, string>> = { msr: "Site measure", cm: "Carpentry measure", sb: "Site briefing" };
export const APPT_TYPE: Readonly<Record<ApptKey, string>> = { msr: "measure", cm: "measure", sb: "briefing" };
const APPT_KIND: Readonly<Record<ApptKey, BetaBoardAppointment["kind"]>> = { msr: "site_measure", cm: "carpentry_measure", sb: "site_briefing" };
export const apptKindOf = (key: ApptKey): BetaBoardAppointment["kind"] => APPT_KIND[key];

export const EVENT_TYPES = [
  ["update", "Drawing update"], ["client", "Client meeting"], ["measure", "Site measure"], ["briefing", "Site briefing"],
  ["meeting", "Internal meeting"], ["w3d", "3D"], ["w2d", "2D"], ["amend", "Amendment"], ["po", "PO / C.PO"],
] as const;
export type EventTypeKey = (typeof EVENT_TYPES)[number][0];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(EVENT_TYPES);
export const typeLabel = (type: string): string => TYPE_LABEL[type] ?? type;
/** The old fixed list, for a server without migration 0342. */
export const LEGACY_WORK_TYPES: BetaWorkType[] = [
  ["measure", "Site measure", "measure", true, 10, true], ["w3d", "3D", "approve_3d", true, 20, true], ["w2d", "2D", "approve_2d", true, 30, true],
  ["carpentry", "Carpentry measure", "booking", true, 50, true], ["briefing", "Site briefing", "booking", true, 60, true],
  ["update", "Drawing update", "booking", false, 110, false], ["client", "Client meeting", "booking", false, 120, false], ["meeting", "Internal meeting", "booking", false, 130, false],
  ["amend", "Amendment", "booking", false, 140, false], ["po", "PO / C.PO", "booking", false, 150, false],
].map(([code, label, rule, inDesign, sortOrder, system], i) => ({
  id: -(i + 1), code, label, rule, bookable: code !== "payment_2", inDesign, sortOrder, active: true, system,
}) as BetaWorkType);
/** The list's names become the calendar's names for each type. */
function rememberWorkTypes(list: BetaWorkType[]): BetaWorkType[] {
  for (const w of list) TYPE_LABEL[w.code] = w.label;
  return list;
}
const GROUP: Readonly<Record<string, EventGroup>> = {
  update: "upd", client: "meet", measure: "meet", carpentry: "meet", briefing: "meet", meeting: "meet", w3d: "work", w2d: "work", amend: "work", po: "work",
};
/** The works of the list that are a project's appointment (Book time on the Design progress row): booked on the calendar
    with a project, they are saved as that appointment, so the row, the to-do list and the step read the same booking. */
export const WORK_APPT: Readonly<Record<string, ApptKey>> = { measure: "msr", carpentry: "cm", briefing: "sb" };
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

/** The people of a booking: its list, else its one person (an older server); someone not known any more is left out. */
function bookingPeople(b: { personId: number | null; personIds?: number[] }, byId: ReadonlyMap<number, PersonRef>): PersonRef[] {
  const ids = b.personIds?.length ? b.personIds : b.personId != null ? [b.personId] : [];
  return ids.flatMap((id) => { const x = byId.get(id); return x ? [x] : []; });
}

/** Each person by id. An old row not offered (imported before user accounts) reads as the one offered person of the same
    name, ignoring case and spaces, so Viewing that person finds the projects on the old row (YH, 23 Nov 2026).
    shortcut: an inactive account also counts as not offered; send pos_user_id on the board if two people share a name. */
function personRefs(list: readonly BetaBoardPerson[]): Map<number, PersonRef> {
  const k = (s: string): string => s.replace(/\s+/g, "").toLowerCase();
  const offered = list.filter((x) => x.offered ?? true);
  return new Map(list.map((x) => {
    const same = x.offered ?? true ? [] : offered.filter((o) => k(o.name) === k(x.name));
    const to = same.length === 1 ? same[0] : x;
    return [x.id, { id: to.id, name: to.name }] as const;
  }));
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
  const people = personRefs(board.people);
  const ref = (r: BetaBoardRef | null): PersonRef | null => (r ? people.get(r.id) ?? { id: r.id, name: r.name } : null);
  const amd = board.settings.amendmentDays;
  return board.projects.map((p) => {
    const title = [p.building, p.unitNo].filter((x): x is string => !!x && x.trim() !== "").join(" ") || p.name;
    const customer = p.customerName?.trim() || null;
    const lead = ref(p.lead);
    const team = (list: BetaBoardRef[] | undefined, one: BetaBoardRef | null): PersonRef[] => {
      const picked = list ?? (one ? [one] : []);
      /* An old row and its account both picked read as one person, once. */
      return picked.length ? [...new Map(picked.map((x) => [ref(x)!.id, ref(x)!] as const)).values()] : lead ? [lead] : [];
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
      if (a) {
        const going = bookingPeople(a, people);
        appts[key] = { d: a.onDate, t: a.atTime?.slice(0, 5) ?? "", who: going[0] ?? null, people: going, whoText: a.whoText ?? null, with: a.withText, done: a.doneAt != null };
      }
    }
    return {
      id: p.id,
      code: p.code,
      title,
      customer,
      brand: p.brand?.trim() || null,
      salesName: p.salesName,
      createdOn: p.createdOn,
      createdAt: p.createdAt ?? (p.createdOn ? `${p.createdOn}T00:00:00Z` : null),
      building: p.building,
      unitNo: p.unitNo,
      soDocNos: p.soDocNos ?? [],
      name: customer ? `${title} · ${customer}` : title,
      tag: p.building?.trim() || buildingFromTitle(title),
      lead,
      by: { "3": joinedRef(t3), "2": joinedRef(t2) },
      team: { "3": t3, "2": t2 },
      site: ref(p.sitePic),
      unassigned: lead == null,
      handover: p.handoverOn,
      handedOver: p.handedOverOn ?? null,
      measuredOn: p.measuredOn,
      design: { "3": d3, "2": d2 },
      po: p.poDoneOn,
      appts,
      payment: paymentText(p),
      paid: p.payment.state === "ok" ? p.payment.paid ?? null : null,
      works: Object.fromEntries((p.works ?? []).map((w) => [w.type, { d: w.onDate, t: w.atTime?.slice(0, 5) ?? "", done: !!w.done }])),
      variants: { lines: p.variants?.lines ?? 0, missing: p.variants?.missing ?? 0, pending: p.variants?.pending ?? [] },
      outstandingSen: p.payment.state === "ok" ? p.payment.outstandingSen ?? null : null,
    };
  });
}

export function buildModel(board: BetaBoard): BoardModel {
  const projects = toBoardProjects(board);
  const byId = new Map(projects.map((p) => [p.id, p] as const));
  const person = personRefs(board.people);
  const everyone: BoardPerson[] = board.people.map((x) => ({
    id: x.id, name: x.name, position: x.position ?? null, department: x.department ?? null, offered: x.offered ?? true,
    managerPersonId: x.managerPersonId == null ? null : person.get(x.managerPersonId)?.id ?? x.managerPersonId,
  }));
  const people = everyone.filter((x) => x.offered).map((x) => ({ id: x.id, name: x.name }));
  const workTypes = rememberWorkTypes(board.workTypes?.length ? board.workTypes : LEGACY_WORK_TYPES);
  const bookable = new Set(workTypes.filter((w) => w.bookable).map((w) => w.code));
  /* A booked work is done once its day has passed (owner, 19 Nov 2026), as an appointment is (adone): before, a stored
     entry stayed open on the calendar after its day while the Design progress row already said Done. */
  const events: CalEvent[] = board.events.map((e) => {
    const going = bookingPeople(e, person);
    return {
      id: `e${e.id}`, d: e.onDate, t: e.atTime?.slice(0, 5) ?? "", type: e.type, note: e.note ?? "",
      who: going[0] ?? null, people: going, whoText: e.whoText ?? null, projectId: e.projectId,
      done: e.done || (bookable.has(e.type) && e.onDate < board.today), eventId: e.id, appt: null,
    };
  });
  return {
    today: board.today,
    mePersonId: board.mePersonId == null ? null : person.get(board.mePersonId)?.id ?? board.mePersonId,
    sop: { "3": board.settings.design3dDays, "2": board.settings.design2dDays },
    amd: board.settings.amendmentDays,
    people,
    everyone,
    projects,
    byId,
    events,
    workTypes,
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

/** Measured = a site measure is recorded (its date, who measured, notes, photos), the same fact the project page
    reads. A booked or ticked appointment alone is not a measure (live run, 24 Oct 2026: Beta said Done while the
    project page said Not measured). */
export function measured(_m: BoardModel, p: DesignProject): boolean {
  return !!p.measuredOn;
}

/** Past the measure for the design flow: measured, or the 3D has started anyway (older projects with no record). */
export function pastMeasure(m: BoardModel, p: DesignProject): boolean {
  return measured(m, p) || !!p.design["3"].s;
}

/** Who does an appointment: the person on it, else the design lead. */
export const apptWho = (p: DesignProject, a: Appt): PersonRef | null => a.who ?? p.lead;

/** Everyone on an appointment's calendar: its people; with nobody picked and no typed name, the design lead. */
export const apptPeople = (p: DesignProject, a: Appt): PersonRef[] => (a.people.length ? a.people : a.whoText ? [] : p.lead ? [p.lead] : []);

/** The "with" text the mockup fills in for each appointment. */
export function apptWithDefault(p: DesignProject, key: ApptKey): string {
  return key === "msr" ? "Client" : key === "cm" ? "Carpenter" : p.site?.name ?? "Site PIC";
}

/** The Design steps (owner, 19 Nov 2026): the works marked in Design in Project Maintenance, in order, then Variants,
    which the system checks. Short labels for the step row. */
const SHORT: Readonly<Record<string, string>> = { measure: "Measure", carpentry: "Carpentry", briefing: "Site PIC", payment_2: "2nd payment" };
export function designSteps(m: Pick<BoardModel, "workTypes">): Array<readonly [StepKey, string]> {
  const works = m.workTypes.filter((w) => w.inDesign && w.active).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return [...works.map((w) => [w.code, SHORT[w.code] ?? w.label] as const), ["variants", "Variants"] as const];
}

/** Whether a Design step is done (owner, 19 Nov 2026): Site measure, Carpentry measure, Site briefing and every
    booked work once their booked day has passed (a recorded measure counts too); 3D and 2D on Record approval; Second
    payment once the second instalment is received; Variants when every sales order line has its variants. */
export function stepDone(m: BoardModel, p: DesignProject, k: StepKey): boolean {
  switch (k) {
    // Past the measure once the 3D has started, as the condition pill reads it (24 Nov 2026: pill said 3D sent, Measure stayed open).
    case "measure": return pastMeasure(m, p) || adone(m, p.appts.msr);
    case "w3d": return p.design["3"].ok;
    case "w2d": return p.design["2"].ok;
    case "payment_2": return (p.paid ?? 0) >= 2;
    case "carpentry": return adone(m, p.appts.cm);
    case "briefing": return adone(m, p.appts.sb);
    case "variants": return p.variants.lines > 0 && p.variants.missing === 0;
    default: {
      const w = p.works[k];
      return !!w && (w.done || w.d < m.today);
    }
  }
}

export function status(m: BoardModel, p: DesignProject): readonly [Letter, string] {
  if (p.unassigned) return ["A", "New · team not assigned"];
  if (!pastMeasure(m, p)) return ["A", p.appts.msr?.d ? "Site measure booked" : "Pending site measure"];
  const g3 = stage(m, p, "3");
  if (g3.st !== "ok") return ["B", g3.st === "none" ? "Pending 3D design" : g3.st === "wait" ? "3D sent · waiting client" : g3.r.n ? "3D amendment" : "3D in progress"];
  const g2 = stage(m, p, "2");
  if (g2.st !== "ok") return ["C", g2.st === "none" ? "Pending 2D" : g2.st === "wait" ? "2D sent · waiting client" : g2.r.n ? "2D amendment" : "2D in progress"];
  // After 2D, the first Design step of the list still open (owner, 19 Nov 2026: Design work in Project Maintenance).
  const rest = designSteps(m).filter(([k]) => k !== "measure" && k !== "w3d" && k !== "w2d");
  const open = rest.find(([k]) => !stepDone(m, p, k));
  if (open) {
    const [k, label] = open;
    const booked = k === "carpentry" ? p.appts.cm?.d : k === "briefing" ? p.appts.sb?.d : p.works[k]?.d;
    const name = m.workTypes.find((w) => w.code === k)?.label ?? label;
    return ["D", booked ? `${name} booked` : `Pending ${name.toLowerCase()}`];
  }
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
      if (!a || adone(m, a) || !mineAny(who, apptPeople(p, a))) continue;
      out.push({ type: "appt", p, ak, a, due: a.d, by: joinedRef(apptPeople(p, a)) });
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

export function deadlineGroups(m: BoardModel, who: Viewing): DeadlineGroups {
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
    if (!p.unassigned && !p.design["3"].s && pastMeasure(m, p) && mineAny(who, p.team["3"])) g.ready.push({ p, k: "3" });
    else if (p.design["3"].ok && !p.design["2"].s && mineAny(who, p.team["2"])) g.ready.push({ p, k: "2" });
  }
  for (const p of m.projects) {
    /* A project with no design lead belongs to nobody, so it is listed under Whole team only, like Progress's
       "Not assigned" (YH, 11 Nov 2026). Before, anyone who could assign saw it whoever Viewing named. */
    if (p.unassigned) {
      if (who === "All") g.todo.push({ p, k: "as" });
      continue;
    }
    if (!mine(who, p.lead?.id)) continue;
    if (!pastMeasure(m, p) && !p.appts.msr?.d) g.todo.push({ p, k: "msr" });
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
      const it: Next = { t: APPT_LABEL[ak], d: a.d, by: joinedRef(apptPeople(p, a)) ?? apptWho(p, a) };
      if (!best || (it.d ?? "") < (best.d ?? "")) best = it;
    }
  }
  if (!best) {
    const w = (["3", "2"] as const).filter((k) => stage(m, p, k).st === "wait").map((k) => `${k}D`);
    if (w.length) best = { t: `${w.join(" & ")} waiting for client`, d: null, by: null };
  }
  return best;
}

/** The list's filter (owner, 19 Nov 2026): every project, the projects whose current Design step is one step
    (`step:<code>`, the code from designSteps), or the ones with every Design step done. */
export type HomeFilter = "all" | "done" | `step:${string}`;

export function inFilter(m: BoardModel, p: DesignProject, f: HomeFilter): boolean {
  if (f === "all") return true;
  const cur = currentStep(m, p);
  if (f === "done") return cur === 99;
  if (f === VARIANTS_FILTER) return waitingVariants(p);
  return designSteps(m)[cur]?.[0] === f.slice(5);
}

/** Variants is checked on its own, not as "the step the project is on" (owner, 20 Nov 2026: pressing Variants showed
    none while lines still waited, because those projects were still on Measure). It lists every project with a sales
    order line still missing a required variant, whatever step it is on. */
export const VARIANTS_FILTER = "step:variants" as const;
export const waitingVariants = (p: Pick<DesignProject, "variants">): boolean => p.variants.missing > 0;

/** How many projects each filter shows; `steps` is keyed by step code. */
export function homeCounts(m: BoardModel): { late: number; week: number; all: number; done: number; steps: Record<string, number> } {
  let late = 0;
  let week = 0;
  for (const p of m.projects) {
    const nx = nextFor(m, p);
    if (!nx?.d) continue;
    const l = diff(nx.d, m.today);
    if (l < 0) late++;
    else if (l <= 7) week++;
  }
  return { late, week, ...filterCounts(m, m.projects) };
}

/** The filter counts over a list of projects (the search narrows it). */
export function filterCounts(m: BoardModel, list: readonly DesignProject[]): { all: number; done: number; steps: Record<string, number> } {
  const ds = designSteps(m);
  const steps: Record<string, number> = Object.fromEntries(ds.map(([k]) => [k, 0]));
  let done = 0;
  for (const p of list) {
    const k = ds[currentStep(m, p)]?.[0];
    if (k === undefined) done++;
    else if (k !== "variants") steps[k]++;
  }
  if ("variants" in steps) steps.variants = list.filter(waitingVariants).length;
  return { all: list.length, done, steps };
}

/** The filter's projects: projects with no team first, then the soonest next deadline, none last. */
export function homeList(m: BoardModel, f: HomeFilter): DesignProject[] {
  return m.projects.filter((p) => inFilter(m, p, f)).sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? -1 : 1;
    return (nextFor(m, a)?.d ?? "9999").localeCompare(nextFor(m, b)?.d ?? "9999");
  });
}

/** The one word the list shows for a condition. */
export type ConditionWord = "Pending" | "Waiting" | "Progress" | "Amendment" | "Done";

export function conditionWord(words: string): ConditionWord {
  if (/amendment/i.test(words)) return "Amendment";
  if (/waiting/i.test(words)) return "Waiting";
  if (/in progress/i.test(words)) return "Progress";
  if (/^Done/.test(words)) return "Done";
  return "Pending";
}

export interface HomeRow {
  p: DesignProject;
  /** The full condition, "B - 3D amendment", for the hover text. */
  cond: string;
  word: ConditionWord;
  left: number | null;
}

export function homeRow(m: BoardModel, p: DesignProject): HomeRow {
  const nx = nextFor(m, p);
  return {
    p,
    cond: conditionText(m, p),
    word: conditionWord(status(m, p)[1]),
    left: nx?.d ? diff(nx.d, m.today) : null,
  };
}

/** The offered people who report straight to this person (System > Users > Reports to), by name. */
export function reportsOf(m: BoardModel, personId: number): PersonRef[] {
  return m.everyone
    .filter((x) => x.offered && x.id !== personId && x.managerPersonId === personId)
    .map((x) => ({ id: x.id, name: x.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- Progress ---------- */

export function progressList(m: BoardModel, who: Viewing): DesignProject[] {
  return m.projects
    .filter((p) => mine(who, p.lead?.id) || mineAny(who, p.team["3"]) || mineAny(who, p.team["2"]) || mine(who, p.site?.id))
    .sort((a, b) => currentStep(m, a) - currentStep(m, b));
}

/** The whole team's progress as one group per person, by name: each project under everyone on any of its steps (lead,
    3D, 2D, site), so a project handed from A to B for a step is in B's group too; projects with nobody under null. */
export function progressByPerson(m: BoardModel): Array<{ person: PersonRef | null; projects: DesignProject[] }> {
  const people = new Map<number, PersonRef>();
  for (const p of m.projects) for (const x of [p.lead, ...p.team["3"], ...p.team["2"], p.site]) if (x) people.set(x.id, x);
  const out: Array<{ person: PersonRef | null; projects: DesignProject[] }> = [...people.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person) => ({ person, projects: progressList(m, person.id) }));
  const seen = new Set(out.flatMap((g) => g.projects.map((p) => p.id)));
  const none = progressList(m, "All").filter((p) => !seen.has(p.id));
  if (none.length) out.push({ person: null, projects: none });
  return out;
}

/** The index of the step the project is on now, or 99 when every step is done. */
export function currentStep(m: BoardModel, p: DesignProject): number {
  const i = designSteps(m).findIndex(([k]) => !stepDone(m, p, k));
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
        who: apptPeople(p, a)[0] ?? null, people: apptPeople(p, a), whoText: a.whoText ?? null, projectId: p.id, done: adone(m, a), eventId: null, appt: { projectId: p.id, key },
      });
    }
  }
  return out;
}

/** Who goes, as the screens write it: the picked people, then the typed name. */
export const whoName = (e: Pick<CalEvent, "people" | "whoText">): string | null =>
  [...e.people.map((x) => x.name), e.whoText?.trim() ?? ""].filter(Boolean).join(", ") || null;

/** Every booking of one project, newest day first (owner, 20 Nov 2026: a project's bookings listed on its page). */
export function projectBookings(m: BoardModel, projectId: number): CalEvent[] {
  return allEvents(m).filter((e) => e.projectId === projectId)
    .sort((a, b) => (b.d + timeKey(b.t)).localeCompare(a.d + timeKey(a.t)));
}

export const allEvents = (m: BoardModel): CalEvent[] => [...m.events, ...apptEvents(m)];

const timeKey = (t: string): string => t || "99";

export function eventsOn(m: BoardModel, who: Viewing, day: string): CalEvent[] {
  return allEvents(m).filter((e) => e.d === day && mineAny(who, e.people)).sort((a, b) => timeKey(a.t).localeCompare(timeKey(b.t)));
}

/** The side list: the picked day's events, or the next eight that are not done. */
export function listFor(m: BoardModel, who: Viewing, selDay: string | null): { title: string; due: DueItem[]; events: CalEvent[] } {
  if (selDay) {
    return {
      title: ds(selDay) + (selDay === m.today ? " · today" : ""),
      due: dueOn(m, who, selDay),
      events: allEvents(m).filter((e) => e.d === selDay && mineAny(who, e.people)).sort((a, b) => (a.d + timeKey(a.t)).localeCompare(b.d + timeKey(b.t))),
    };
  }
  const events = allEvents(m)
    .filter((e) => e.d >= m.today && mineAny(who, e.people) && !e.done)
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
