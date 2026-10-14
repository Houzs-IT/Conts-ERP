/* Input rules for the records of the simplified project (owner decisions 11 Oct
   2026): people master, unit key moves, site measures, design files, the manual
   step and the hold flag. Pure: each answers a cleaned value or a refusal code. */

import { PERSON_ROLES, isFlowStepKey, type FlowStepKey, type HoldFlag, type PersonRole } from "../../scm/shared/renovation-stages";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const posInt = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (x: unknown, max = 500): string | null => {
  const s = String(x ?? "").trim();
  return s ? s.slice(0, max) : null;
};

export type Refusal<T> = { ok: true; value: T } | { ok: false; error: string; message: string };
const no = (error: string, message: string) => ({ ok: false as const, error, message });

export interface PersonInput { name: string; roles: PersonRole[]; active: boolean; userId: number | null; phone: string | null; notes: string | null }

/** `partial` for a PATCH: only the fields present are checked and returned. */
export function cleanPerson(b: Record<string, unknown>, partial = false): Refusal<Partial<PersonInput>> {
  const out: Partial<PersonInput> = {};
  if (!partial || "name" in b) {
    const name = text(b.name, 120);
    if (!name) return no("name_required", "Give the person a name.");
    out.name = name;
  }
  if (!partial || "roles" in b) {
    const raw = Array.isArray(b.roles) ? b.roles.map(String) : [];
    const bad = raw.filter((r) => !(PERSON_ROLES as readonly string[]).includes(r));
    if (bad.length) return no("role_invalid", `Unknown role: ${bad.join(", ")}.`);
    out.roles = [...new Set(raw)] as PersonRole[];
  }
  if (!partial || "active" in b) out.active = b.active === undefined ? true : b.active === true;
  if (!partial || "userId" in b) {
    if (b.userId != null && b.userId !== "" && posInt(b.userId) === null) return no("user_invalid", "That login does not exist.");
    out.userId = b.userId == null || b.userId === "" ? null : posInt(b.userId);
  }
  if (!partial || "phone" in b) out.phone = text(b.phone, 40);
  if (!partial || "notes" in b) out.notes = text(b.notes, 1000);
  return { ok: true, value: out };
}

export interface KeyMoveInput { movedOn: string; fromPersonId: number | null; toPersonId: number | null; note: string | null }

export function cleanKeyMove(b: Record<string, unknown>, today: string): Refusal<KeyMoveInput> {
  const movedOn = String(b.movedOn ?? today);
  if (!DATE.test(movedOn)) return no("date_invalid", "Give the date as YYYY-MM-DD.");
  if (movedOn > today) return no("date_in_future", "A key move cannot be in the future.");
  const from = b.fromPersonId == null || b.fromPersonId === "" ? null : posInt(b.fromPersonId);
  const to = b.toPersonId == null || b.toPersonId === "" ? null : posInt(b.toPersonId);
  if ((b.fromPersonId != null && b.fromPersonId !== "" && from === null) || (b.toPersonId != null && b.toPersonId !== "" && to === null)) {
    return no("person_invalid", "Pick the people from the list.");
  }
  if (from === null && to === null) return no("person_required", "Say who passed the key, who received it, or both.");
  if (from !== null && from === to) return no("same_person", "The key cannot pass from a person to the same person.");
  return { ok: true, value: { movedOn, fromPersonId: from, toPersonId: to, note: text(b.note) } };
}

export interface SiteMeasureInput { doneOn: string; personId: number | null; personIds: number[]; note: string | null }

/** Several people (personIds), or the older single personId. personId answers the first, for single-person readers. */
function cleanPeopleList(b: Record<string, unknown>): Refusal<{ personId: number | null; personIds: number[] }> {
  let raw: unknown[];
  if (Array.isArray(b.personIds)) raw = b.personIds;
  else if (b.personId == null || b.personId === "") raw = [];
  else raw = [b.personId];
  const ids = raw.map(posInt);
  if (ids.some((x) => x === null)) return no("person_invalid", "Pick the people from the list.");
  const list = [...new Set(ids as number[])].slice(0, 50);
  return { ok: true, value: { personId: list[0] ?? null, personIds: list } };
}

export function cleanSiteMeasure(b: Record<string, unknown>): Refusal<SiteMeasureInput> {
  const doneOn = String(b.doneOn ?? "");
  if (!DATE.test(doneOn)) return no("date_required", "Give the site measure date as YYYY-MM-DD.");
  const people = cleanPeopleList(b);
  if (!people.ok) return people;
  return { ok: true, value: { doneOn, ...people.value, note: text(b.note, 2000) } };
}

export const DESIGN_FILE_TYPES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/zip": "zip", "application/octet-stream": "bin", "image/vnd.dwg": "dwg", "application/acad": "dwg",
};
export const DESIGN_FILE_MAX = 25 * 1024 * 1024;

export function cleanDesignKind(x: unknown): "2d" | "3d" | "other" | null {
  const k = String(x ?? "").toLowerCase();
  return k === "2d" || k === "3d" || k === "other" ? k : null;
}

export function cleanManualStep(b: Record<string, unknown>): Refusal<{ step: FlowStepKey; reason: string | null }> {
  const step = String(b.step ?? "");
  if (!isFlowStepKey(step)) return no("step_invalid", "Pick one of the project steps.");
  return { ok: true, value: { step, reason: text(b.reason) } };
}

export function cleanHold(b: Record<string, unknown>): Refusal<{ flag: HoldFlag; note: string | null }> {
  const flag = String(b.flag ?? "");
  if (flag !== "in_defect" && flag !== "on_hold") return no("flag_invalid", "Choose In defect or On hold.");
  return { ok: true, value: { flag, note: text(b.note) } };
}

/** Attending people of a project (owner, 14 Oct 2026): the whole set, replacing what was there. */
export function cleanAttending(b: Record<string, unknown>): Refusal<number[]> {
  if (!Array.isArray(b.attendingPersonIds)) return no("person_invalid", "Pick the people from the list.");
  const ids = b.attendingPersonIds.map(posInt);
  if (ids.some((x) => x === null)) return no("person_invalid", "Pick the people from the list.");
  const list = [...new Set(ids as number[])];
  if (list.length > 100) return no("too_many", "That is more people than a project can list.");
  return { ok: true, value: list };
}

const optPerson = (x: unknown): number | null | false => (x == null || x === "" ? null : posInt(x) ?? false);
const pastDate = (x: unknown, today: string): Refusal<string> => {
  const s = x == null || x === "" ? today : String(x);
  if (!DATE.test(s)) return no("date_invalid", "Give the date as YYYY-MM-DD.");
  if (s > today) return no("date_in_future", "That date is still ahead.");
  return { ok: true, value: s };
};

export interface DesignLinkInput { kind: "2d" | "3d" | "other"; url: string; submittedOn: string; personId: number | null; personIds: number[]; nextPersonId: number | null; note: string | null }

/** A design submission given as a link (3D is always a link). nextPersonId (the 2D PIC) applies to 3D only. */
export function cleanDesignLink(b: Record<string, unknown>, today: string): Refusal<DesignLinkInput> {
  const kind = cleanDesignKind(b.kind);
  if (!kind) return no("kind_invalid", "Say whether this is a 2D, 3D or other submission.");
  const url = String(b.url ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return no("url_invalid", "Paste the full link, starting with https://.");
  const on = pastDate(b.submittedOn, today);
  if (!on.ok) return on;
  const people = cleanPeopleList(b);
  const next = optPerson(b.nextPersonId);
  if (!people.ok || next === false) return no("person_invalid", "Pick the people from the list.");
  return { ok: true, value: { kind, url, submittedOn: on.value, ...people.value, nextPersonId: kind === "3d" ? next : null, note: text(b.note) } };
}

export interface DesignNoteInput { kind: "2d" | "3d"; notedOn: string; requestedByPersonId: number | null; requestedByText: string | null; note: string }

/** A change request on the 3D or the 2D: when, who asked (a person, free text or nobody), what to change. */
export function cleanDesignNote(b: Record<string, unknown>, today: string): Refusal<DesignNoteInput> {
  const kind = String(b.kind ?? "").toLowerCase();
  if (kind !== "2d" && kind !== "3d") return no("kind_invalid", "A note belongs to the 3D or the 2D.");
  const on = pastDate(b.notedOn, today);
  if (!on.ok) return on;
  const person = optPerson(b.requestedByPersonId);
  if (person === false) return no("person_invalid", "Pick the person from the list.");
  const note = text(b.note, 2000);
  if (!note) return no("note_required", "Say what to change.");
  return { ok: true, value: { kind, notedOn: on.value, requestedByPersonId: person, requestedByText: person ? null : text(b.requestedByText, 120), note } };
}

export interface DesignFilePatch { personIds?: number[]; personId?: number | null; nextPersonId?: number | null; submittedOn?: string; url?: string; note?: string | null }

/** An edit to a design version: only the fields sent are checked and returned. */
export function cleanDesignFilePatch(b: Record<string, unknown>, today: string): Refusal<DesignFilePatch> {
  const out: DesignFilePatch = {};
  if ("personIds" in b) {
    const p = cleanPeopleList({ personIds: b.personIds });
    if (!p.ok) return p;
    out.personIds = p.value.personIds;
    out.personId = p.value.personId;
  }
  if ("nextPersonId" in b) {
    const n = optPerson(b.nextPersonId);
    if (n === false) return no("person_invalid", "Pick the people from the list.");
    out.nextPersonId = n;
  }
  if ("submittedOn" in b) {
    const on = pastDate(b.submittedOn, today);
    if (!on.ok) return on;
    out.submittedOn = on.value;
  }
  if ("url" in b) {
    const url = String(b.url ?? "").trim();
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return no("url_invalid", "Paste the full link, starting with https://.");
    out.url = url;
  }
  if ("note" in b) out.note = text(b.note);
  return { ok: true, value: out };
}
