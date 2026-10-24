/* Input rules for a 2D version given as sheets (Beta Drawings, owner 24 Oct 2026; migration 0149). The files go up
   first, one by one, through POST /api/beta/projects/:id/sheet-files; the version is then saved with the list of
   sheets in one request, so a version never exists with half of its sheets. Pure: a cleaned value or a refusal. */

import { DESIGN_FILE_TYPES } from "./records";

export type Refusal<T> = { ok: true; value: T } | { ok: false; error: string; message: string };
const no = (error: string, message: string) => ({ ok: false as const, error, message });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SHEETS_MAX = 100;

export interface SheetInput { name: string; key: string; fileName: string; contentType: string; size: number }
export interface SheetSetInput { submittedOn: string; personIds: number[]; note: string | null; sheets: SheetInput[] }

/** The R2 key a sheet upload of this project gets; a sheet in a version must be one of these. */
export const sheetKeyPrefix = (projectId: number): string => `renovation/${projectId}/sheet-`;

const posInt = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function cleanSheetSet(b: Record<string, unknown>, projectId: number, today: string): Refusal<SheetSetInput> {
  const submittedOn = b.submittedOn == null || b.submittedOn === "" ? today : String(b.submittedOn);
  if (!DATE.test(submittedOn)) return no("date_invalid", "Give the date as YYYY-MM-DD.");
  if (submittedOn > today) return no("date_in_future", "That date is still ahead.");

  const rawPeople = Array.isArray(b.personIds) ? b.personIds : [];
  const people = rawPeople.map(posInt);
  if (people.some((x) => x === null)) return no("person_invalid", "Pick the people from the list.");
  const personIds = [...new Set(people as number[])].slice(0, 50);

  const note = String(b.note ?? "").trim().slice(0, 500) || null;

  if (!Array.isArray(b.sheets) || b.sheets.length === 0) return no("sheets_required", "Add at least one sheet.");
  if (b.sheets.length > SHEETS_MAX) return no("too_many", `A version can hold up to ${SHEETS_MAX} sheets.`);
  const prefix = sheetKeyPrefix(projectId);
  const seen = new Set<string>();
  const sheets: SheetInput[] = [];
  for (const raw of b.sheets as unknown[]) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const name = String(s.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) return no("name_required", "Give every sheet a name.");
    if (name.length > 120) return no("name_too_long", "A sheet name can be up to 120 characters.");
    const lower = name.toLowerCase();
    if (seen.has(lower)) return no("name_duplicate", `Two sheets are named "${name}". Give each sheet its own name.`);
    seen.add(lower);
    const key = String(s.key ?? "");
    if (!key.startsWith(prefix) || key.includes("..") || key.length > 300) return no("key_invalid", "Upload the sheet files again.");
    const contentType = String(s.contentType ?? "").toLowerCase();
    if (!DESIGN_FILE_TYPES[contentType]) return no("unsupported_type", "PDF, image, DWG or ZIP files only.");
    const size = posInt(s.size);
    if (!size) return no("key_invalid", "Upload the sheet files again.");
    const fileName = String(s.fileName ?? "").trim().slice(0, 200) || name;
    sheets.push({ name, key, fileName, contentType, size });
  }
  return { ok: true, value: { submittedOn, personIds, note, sheets } };
}

/** What a 2D version holding sheets is called in lists: the first set, or the sheets that changed. */
export function sheetVersionName(isFirst: boolean, count: number): string {
  const n = `${count} sheet${count === 1 ? "" : "s"}`;
  return isFirst ? `2D set, ${n}` : `${n} updated`;
}

/** A sheet name as stored: trimmed, inner spaces folded (the same cleaning as a new set). */
export function cleanSheetName(x: unknown): Refusal<string> {
  const name = String(x ?? "").trim().replace(/\s+/g, " ");
  if (!name) return no("name_required", "Give the sheet a name.");
  if (name.length > 120) return no("name_too_long", "A sheet name can be up to 120 characters.");
  return { ok: true, value: name };
}

/** Renaming a sheet (every file it had, in every version): the new name must be free among the project's other sheets,
 *  removed ones included, or two sheets would merge into one set entry. Changing only the capitals is allowed. */
export function cleanSheetRename(b: Record<string, unknown>, names: readonly string[]): Refusal<{ from: string; to: string }> {
  const from = cleanSheetName(b.name);
  if (!from.ok) return from;
  const to = cleanSheetName(b.newName);
  if (!to.ok) return to;
  const lower = names.map((n) => n.toLowerCase());
  if (!lower.includes(from.value.toLowerCase())) return no("sheet_not_found", "That sheet is not in this project's 2D set.");
  if (from.value === to.value) return no("unchanged", "The name is the same.");
  if (from.value.toLowerCase() !== to.value.toLowerCase() && lower.includes(to.value.toLowerCase())) {
    return no("name_duplicate", `There is already a sheet named "${to.value}". Give this sheet its own name.`);
  }
  return { ok: true, value: { from: from.value, to: to.value } };
}

export const LINKS_MAX = 50;

export interface LinkSetInput { submittedOn: string; personIds: number[]; nextPersonId: number | null; note: string | null; links: Array<{ name: string; url: string }> }

/** A 3D version given as several named links (migration 0155): each needs its own name and a full http(s) address. */
export function cleanLinkSet(b: Record<string, unknown>, today: string): Refusal<LinkSetInput> {
  const submittedOn = b.submittedOn == null || b.submittedOn === "" ? today : String(b.submittedOn);
  if (!DATE.test(submittedOn)) return no("date_invalid", "Give the date as YYYY-MM-DD.");
  if (submittedOn > today) return no("date_in_future", "That date is still ahead.");
  const rawPeople = Array.isArray(b.personIds) ? b.personIds : [];
  const people = rawPeople.map(posInt);
  if (people.some((x) => x === null)) return no("person_invalid", "Pick the people from the list.");
  const nextPersonId = b.nextPersonId == null || b.nextPersonId === "" ? null : posInt(b.nextPersonId);
  if (b.nextPersonId != null && b.nextPersonId !== "" && nextPersonId == null) return no("person_invalid", "Pick the people from the list.");
  const note = String(b.note ?? "").trim().slice(0, 500) || null;
  if (!Array.isArray(b.links) || b.links.length === 0) return no("links_required", "Add at least one link.");
  if (b.links.length > LINKS_MAX) return no("too_many", `A version can hold up to ${LINKS_MAX} links.`);
  const seen = new Set<string>();
  const links: Array<{ name: string; url: string }> = [];
  for (const raw of b.links as unknown[]) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const n = cleanSheetName(l.name);
    if (!n.ok) return no(n.error, n.error === "name_required" ? "Give every link a name, e.g. Living room render." : n.message);
    const lower = n.value.toLowerCase();
    if (seen.has(lower)) return no("name_duplicate", `Two links are named "${n.value}". Give each link its own name.`);
    seen.add(lower);
    const url = String(l.url ?? "").trim();
    if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) return no("url_invalid", `Paste the full link for "${n.value}", starting with https://.`);
    links.push({ name: n.value, url });
  }
  return { ok: true, value: { submittedOn, personIds: [...new Set(people as number[])].slice(0, 50), nextPersonId, note, links } };
}

/** What a 3D version holding links is called in lists. */
export function linkVersionName(isFirst: boolean, count: number): string {
  const n = `${count} link${count === 1 ? "" : "s"}`;
  return isFirst ? `3D set, ${n}` : `${n} updated`;
}

/** The sheet kind an action works on: 2D sheets unless 3D links are named. */
export const sheetKindOf = (x: unknown): "2d" | "3d" => (x === "3d" ? "3d" : "2d");
