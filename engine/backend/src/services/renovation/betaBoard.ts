/* Beta Home, Projects and Calendar (owner, 23 Oct 2026; plan docs/superpowers/plans/2026-10-23-beta-project-workspace.md
   section 10; routes/renovationBeta.ts). Pure rules: input checks for the board writes, the payment label, and the
   grouping that turns one query per data set into the BetaBoard answer. No database here. */

import { BETA_NOTE_MAX, isIsoDay, type BetaPayments, type BetaRefusal } from "./beta";

const no = (error: string, message: string): { ok: false; error: string; message: string } => ({ ok: false, error, message });
type Json = Record<string, unknown>;

export const BETA_APPOINTMENT_KINDS = ["site_measure", "carpentry_measure", "site_briefing"] as const;
export type BetaAppointmentKind = (typeof BETA_APPOINTMENT_KINDS)[number];
export const BETA_EVENT_TYPES = ["client", "measure", "briefing", "meeting", "w3d", "w2d", "amend", "po", "update"] as const;
export type BetaEventType = (typeof BETA_EVENT_TYPES)[number];

export const BETA_AMENDMENT_DAYS = 3;
export const BETA_NOTE_DAYS_MAX = 60;
export const BETA_BOARD_MAX_DAYS = 400;
export const BETA_BOARD_DAYS_BEFORE = 60;
export const BETA_BOARD_DAYS_AFTER = 180;

export const isAppointmentKind = (x: unknown): x is BetaAppointmentKind =>
  typeof x === "string" && (BETA_APPOINTMENT_KINDS as readonly string[]).includes(x);
const isEventType = (x: unknown): x is BetaEventType => typeof x === "string" && (BETA_EVENT_TYPES as readonly string[]).includes(x);

/** HH:MM on the 24 hour clock. */
export const isClockTime = (x: unknown): x is string => typeof x === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x);

const blank = (x: unknown): boolean => x == null || x === "";

/** A person or project id (positive whole number) or null; undefined when the value is not one. */
function idOrNull(x: unknown): number | null | undefined {
  if (blank(x)) return null;
  return typeof x === "number" && Number.isInteger(x) && x > 0 ? x : undefined;
}

/** Free text up to BETA_NOTE_MAX characters: null when empty, undefined when it is too long or not text. */
function noteOf(x: unknown): string | null | undefined {
  if (blank(x)) return null;
  if (typeof x !== "string") return undefined;
  const s = x.trim();
  if (s.length > BETA_NOTE_MAX) return undefined;
  return s || null;
}

const DAY_MS = 86_400_000;
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function addDays(iso: string, n: number): string {
  return new Date(dayMs(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

export interface BoardRange { from: string; to: string }

/** The Calendar window: today - 60 to today + 180 by default. Counting both end days, at most 400 days are allowed (the client
    checks days between from and to, plus 1, at most 400); `from` must not be after `to`. */
export function cleanBoardRange(from: string | undefined, to: string | undefined, today: string): BetaRefusal<BoardRange> {
  const f = from || addDays(today, -BETA_BOARD_DAYS_BEFORE);
  const t = to || addDays(today, BETA_BOARD_DAYS_AFTER);
  if (!isIsoDay(f) || !isIsoDay(t)) return no("date_invalid", "Give the dates as YYYY-MM-DD.");
  if (t < f) return no("range_invalid", "The end day cannot be before the start day.");
  if ((dayMs(t) - dayMs(f)) / DAY_MS + 1 > BETA_BOARD_MAX_DAYS) return no("range_too_long", `Ask for at most ${BETA_BOARD_MAX_DAYS} days at a time.`);
  return { ok: true, value: { from: f, to: t } };
}

// ── Writes ───────────────────────────────────────────────────────────────

/** Only the fields the caller sent are present. null clears a date or a person. */
export interface BetaDesignPatch {
  start3dOn?: string | null; start2dOn?: string | null; poDoneOn?: string | null;
  person3dId?: number | null; person2dId?: number | null;
}
export const DESIGN_DATE_FIELDS = ["start3dOn", "start2dOn", "poDoneOn"] as const;
export const DESIGN_PERSON_FIELDS = ["person3dId", "person2dId"] as const;

export function cleanBetaDesign(b: Json): BetaRefusal<BetaDesignPatch> {
  const patch: BetaDesignPatch = {};
  let count = 0;
  for (const k of DESIGN_DATE_FIELDS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (!blank(v) && !isIsoDay(v)) return no("date_invalid", "Give the day as YYYY-MM-DD, or leave it empty.");
    patch[k] = blank(v) ? null : (v as string);
    count++;
  }
  for (const k of DESIGN_PERSON_FIELDS) {
    if (!(k in b)) continue;
    const id = idOrNull(b[k]);
    if (id === undefined) return no("person_invalid", "Pick a person from the list, or leave it empty.");
    patch[k] = id;
    count++;
  }
  if (count === 0) return no("nothing_to_change", "Send at least one thing to change.");
  return { ok: true, value: patch };
}

export function designPersonIds(p: BetaDesignPatch): number[] {
  return [p.person3dId, p.person2dId].filter((x): x is number => typeof x === "number");
}

/** The activity note of a design change, e.g. "3D starts 2026-11-02 · 2D by Aisha". */
export function designChangeNote(p: BetaDesignPatch, nameOf: ReadonlyMap<number, string>): string {
  const day = (label: string, v: string | null | undefined): string | null => (v === undefined ? null : v ? `${label} ${v}` : `${label} cleared`);
  const who = (label: string, v: number | null | undefined): string | null =>
    v === undefined ? null : v == null ? `${label} person cleared` : `${label} by ${nameOf.get(v) ?? `person ${v}`}`;
  return [day("3D starts", p.start3dOn), who("3D", p.person3dId), day("2D starts", p.start2dOn), who("2D", p.person2dId), day("PO done", p.poDoneOn)]
    .filter(Boolean).join(" · ");
}

export function cleanNoteDays(b: Json): BetaRefusal<{ days: number }> {
  const d = b.days;
  if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > BETA_NOTE_DAYS_MAX) return no("days_invalid", `Give whole days from 1 to ${BETA_NOTE_DAYS_MAX}.`);
  return { ok: true, value: { days: d } };
}

export interface BetaAppointmentInput { onDate: string; atTime: string | null; personId: number | null; withText: string | null }

export function cleanBetaAppointment(b: Json): BetaRefusal<BetaAppointmentInput> {
  if (!isIsoDay(b.onDate)) return no("date_invalid", "Give the day as YYYY-MM-DD.");
  if (!blank(b.atTime) && !isClockTime(b.atTime)) return no("time_invalid", "Give the time as HH:MM.");
  const personId = idOrNull(b.personId);
  if (personId === undefined) return no("person_invalid", "Pick a person from the list, or leave it empty.");
  const withText = noteOf(b.withText);
  if (withText === undefined) return no("text_invalid", `Who it is with can be up to ${BETA_NOTE_MAX} characters.`);
  return { ok: true, value: { onDate: b.onDate, atTime: blank(b.atTime) ? null : (b.atTime as string), personId, withText } };
}

export interface BetaEventInput { projectId: number | null; onDate: string; atTime: string | null; type: BetaEventType; note: string | null; personId: number | null }

export function cleanBetaEvent(b: Json): BetaRefusal<BetaEventInput> {
  const projectId = idOrNull(b.projectId);
  if (projectId === undefined) return no("project_invalid", "Pick a project from the list, or leave it empty.");
  if (!isIsoDay(b.onDate)) return no("date_invalid", "Give the day as YYYY-MM-DD.");
  if (!blank(b.atTime) && !isClockTime(b.atTime)) return no("time_invalid", "Give the time as HH:MM.");
  if (!isEventType(b.type)) return no("type_invalid", "Pick the kind of entry from the list.");
  const note = noteOf(b.note);
  if (note === undefined) return no("note_invalid", `A note can be up to ${BETA_NOTE_MAX} characters.`);
  const personId = idOrNull(b.personId);
  if (personId === undefined) return no("person_invalid", "Pick a person from the list, or leave it empty.");
  return { ok: true, value: { projectId, onDate: b.onDate, atTime: blank(b.atTime) ? null : (b.atTime as string), type: b.type, note, personId } };
}

/** The fields of an event change; only the ones the caller sent are present. */
export interface BetaEventPatch {
  projectId?: number | null; onDate?: string; atTime?: string | null; type?: BetaEventType; note?: string | null;
  personId?: number | null; done?: boolean;
}

export function cleanBetaEventPatch(b: Json): BetaRefusal<BetaEventPatch> {
  const p: BetaEventPatch = {};
  if ("projectId" in b) {
    const v = idOrNull(b.projectId);
    if (v === undefined) return no("project_invalid", "Pick a project from the list, or leave it empty.");
    p.projectId = v;
  }
  if ("onDate" in b) {
    if (!isIsoDay(b.onDate)) return no("date_invalid", "Give the day as YYYY-MM-DD.");
    p.onDate = b.onDate;
  }
  if ("atTime" in b) {
    if (!blank(b.atTime) && !isClockTime(b.atTime)) return no("time_invalid", "Give the time as HH:MM.");
    p.atTime = blank(b.atTime) ? null : (b.atTime as string);
  }
  if ("type" in b) {
    if (!isEventType(b.type)) return no("type_invalid", "Pick the kind of entry from the list.");
    p.type = b.type;
  }
  if ("note" in b) {
    const v = noteOf(b.note);
    if (v === undefined) return no("note_invalid", `A note can be up to ${BETA_NOTE_MAX} characters.`);
    p.note = v;
  }
  if ("personId" in b) {
    const v = idOrNull(b.personId);
    if (v === undefined) return no("person_invalid", "Pick a person from the list, or leave it empty.");
    p.personId = v;
  }
  if ("done" in b) {
    if (typeof b.done !== "boolean") return no("done_invalid", "Done must be true or false.");
    p.done = b.done;
  }
  if (Object.keys(p).length === 0) return no("nothing_to_change", "Send at least one thing to change.");
  return { ok: true, value: p };
}

// ── Board ────────────────────────────────────────────────────────────────

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st. */
export function ordinal(n: number): string {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" } as Readonly<Record<number, string | undefined>>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export type BoardPayment = { state: "hidden" } | { state: "none" } | { state: "ok"; label: string };

/** "2 of 4 paid", "Fully paid", or "Pending 2nd payment" while a bill waits for money. A contract without
    instalments has nothing to pay, so it reads as none. */
export function paymentLabel(p: BetaPayments): BoardPayment {
  if (p.state !== "ok") return p.state === "hidden" ? { state: "hidden" } : { state: "none" };
  if (p.instalments.length === 0) return { state: "none" };
  const paid = p.instalments.filter((i) => i.status === "paid").length;
  if (paid === p.instalments.length) return { state: "ok", label: "Fully paid" };
  const next = p.instalments.find((i) => i.status !== "paid");
  if (next?.status === "billed") return { state: "ok", label: `Pending ${ordinal(next.seq)} payment` };
  return { state: "ok", label: `${paid} of ${p.instalments.length} paid` };
}

/** Rows grouped by their project_id, each group in the order the rows came. */
export function groupByProject<T extends { project_id: number }>(rows: readonly T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const r of rows) {
    const list = out.get(r.project_id);
    if (list) list.push(r);
    else out.set(r.project_id, [r]);
  }
  return out;
}

/** Roles from to_json(text[]): an array, or the text form "{designer,sales}". */
export function rolesOf(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(String);
  if (typeof x === "string") return x.replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

/** The Malaysian day a UTC timestamp text (projects.created_at) falls on; null when it is empty or not a time. */
export function createdOnOf(x: string | null): string | null {
  if (!x) return null;
  const t = Date.parse(x);
  if (Number.isNaN(t)) return null;
  return new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
}

export interface BoardPersonRef { id: number; name: string }
const refOf = (id: number | null, name: string | null): BoardPersonRef | null => (id != null ? { id, name: name ?? "" } : null);

export interface BoardProjectRow {
  id: number; code: string | null; name: string; building: string | null; unit_no: string | null; customer_name: string | null;
  sales_name: string | null; created_at: string | null; handover_on: string | null;
  lead_id: number | null; lead_name: string | null; pic_id: number | null; pic_name: string | null;
  p3_id: number | null; p3_name: string | null; p2_id: number | null; p2_name: string | null;
  measured_on: string | null; start_3d_on: string | null; start_2d_on: string | null; po_done_on: string | null;
}
export interface BoardFileRow { id: number; project_id: number; kind: "3d" | "2d"; version: number; submitted_on: string }
export interface BoardNoteRow { id: number; project_id: number; kind: "3d" | "2d"; noted_on: string; closed_on: string | null; days: number | null }
export interface BoardReviewRow { file_id: number; project_id: number; sent_on: string | null; approved_on: string | null }
export interface BoardAppointmentRow {
  project_id: number; kind: BetaAppointmentKind; on_date: string; at_time: string | null; person_id: number | null;
  with_text: string | null; done_at: string | null;
}

export interface BoardSets {
  files: ReadonlyMap<number, readonly BoardFileRow[]>;
  notes: ReadonlyMap<number, readonly BoardNoteRow[]>;
  reviews: ReadonlyMap<number, readonly BoardReviewRow[]>;
  appointments: ReadonlyMap<number, readonly BoardAppointmentRow[]>;
}

export interface BoardProject {
  id: number; code: string | null; name: string; building: string | null; unitNo: string | null;
  customerName: string | null; salesName: string | null; createdOn: string | null; handoverOn: string | null;
  lead: BoardPersonRef | null; person3d: BoardPersonRef | null; person2d: BoardPersonRef | null; sitePic: BoardPersonRef | null;
  measuredOn: string | null; start3dOn: string | null; start2dOn: string | null; poDoneOn: string | null;
  files: Array<{ id: number; kind: "3d" | "2d"; version: number; submittedOn: string }>;
  notes: Array<{ id: number; kind: "3d" | "2d"; notedOn: string; closedOn: string | null; days: number | null }>;
  reviews: Array<{ fileId: number; sentOn: string | null; approvedOn: string | null }>;
  appointments: Array<{ kind: BetaAppointmentKind; onDate: string; atTime: string | null; personId: number | null; withText: string | null; doneAt: string | null }>;
  payment: BoardPayment;
}

/** One project of the board from its own row and the grouped data sets. */
export function buildBoardProject(p: BoardProjectRow, sets: BoardSets, payment: BoardPayment): BoardProject {
  return {
    id: p.id, code: p.code, name: p.name, building: p.building, unitNo: p.unit_no, customerName: p.customer_name, salesName: p.sales_name,
    createdOn: createdOnOf(p.created_at), handoverOn: p.handover_on,
    lead: refOf(p.lead_id, p.lead_name), person3d: refOf(p.p3_id, p.p3_name), person2d: refOf(p.p2_id, p.p2_name), sitePic: refOf(p.pic_id, p.pic_name),
    measuredOn: p.measured_on, start3dOn: p.start_3d_on, start2dOn: p.start_2d_on, poDoneOn: p.po_done_on,
    files: (sets.files.get(p.id) ?? []).map((f) => ({ id: f.id, kind: f.kind, version: f.version, submittedOn: f.submitted_on })),
    notes: (sets.notes.get(p.id) ?? []).map((n) => ({ id: n.id, kind: n.kind, notedOn: n.noted_on, closedOn: n.closed_on, days: n.days })),
    reviews: (sets.reviews.get(p.id) ?? []).map((r) => ({ fileId: r.file_id, sentOn: r.sent_on, approvedOn: r.approved_on })),
    appointments: (sets.appointments.get(p.id) ?? []).map((a) => ({
      kind: a.kind, onDate: a.on_date, atTime: a.at_time, personId: a.person_id, withText: a.with_text, doneAt: a.done_at,
    })),
    payment,
  };
}
