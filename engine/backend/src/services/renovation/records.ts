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

export interface SiteMeasureInput { doneOn: string; personId: number | null; note: string | null }

export function cleanSiteMeasure(b: Record<string, unknown>): Refusal<SiteMeasureInput> {
  const doneOn = String(b.doneOn ?? "");
  if (!DATE.test(doneOn)) return no("date_required", "Give the site measure date as YYYY-MM-DD.");
  const person = b.personId == null || b.personId === "" ? null : posInt(b.personId);
  if (b.personId != null && b.personId !== "" && person === null) return no("person_invalid", "Pick the person from the list.");
  return { ok: true, value: { doneOn, personId: person, note: text(b.note) } };
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
