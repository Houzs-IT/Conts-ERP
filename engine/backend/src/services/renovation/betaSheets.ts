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
