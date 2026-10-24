/* Beta photos and videos that have no document of their own (owner, 24 Oct 2026): the site team's progress photos,
   the photos of a site step, and the second and later before / after photos of a defect. Each is one
   project_activity row (action 'beta_media'):
     from_value  what it belongs to: "progress", "task:<id>", "defect:<id>:before", "defect:<id>:after:<round>"
     to_value    the file's key in the project's store (renovation/<projectId>/...), uploaded first through
                 POST /api/renovation/:id/files
     note        JSON { name, mime, size, area, note }
   Why activity rows and not a table of their own: the deploy workflow applies no database update and production
   cannot be changed from here, so a new table would ship switched off. The activity log is append-only, already
   scoped to the project and company, and the Timeline reads it, so each upload is also a dated history entry.
   A defect's after photos carry the round (its redo count) so photos of a fix that was sent back are not shown
   as the new fix. Pure rules; no database here. */

import type { BetaRefusal } from "./beta";

const no = (error: string, message: string): { ok: false; error: string; message: string } => ({ ok: false, error, message });
type Json = Record<string, unknown>;

export const MEDIA_ACTION = "beta_media";
/** Files per upload. */
export const MEDIA_MAX_ITEMS = 20;
export const MEDIA_AREA_MAX = 120;
export const MEDIA_NOTE_MAX = 500;

/** Photos are shrunk on the phone first; a minute of phone video fits under the video cap (a Worker body is up to 100 MB). */
export const MEDIA_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const MEDIA_VIDEO_MAX_BYTES = 95 * 1024 * 1024;

export const MEDIA_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp",
};

export type MediaKind = "image" | "video" | "file";

export function mediaKindOf(mime: string | null | undefined, name?: string | null): MediaKind {
  const m = String(mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  const n = String(name ?? "").toLowerCase();
  if (/\.(png|jpe?g|webp|gif|heic|heif)$/.test(n)) return "image";
  if (/\.(mp4|mov|webm|3gp|m4v)$/.test(n)) return "video";
  return "file";
}

/** The size cap for a type, or null when the type is not taken. */
export function mediaCap(mime: string): number | null {
  if (!MEDIA_TYPES[mime]) return null;
  return mime.startsWith("video/") ? MEDIA_VIDEO_MAX_BYTES : MEDIA_IMAGE_MAX_BYTES;
}

export type MediaTarget =
  | { kind: "progress" }
  | { kind: "task"; taskId: number }
  | { kind: "defect"; defectId: number; side: "before" | "after"; round: number };

export function targetCode(t: MediaTarget): string {
  if (t.kind === "progress") return "progress";
  if (t.kind === "task") return `task:${t.taskId}`;
  return t.side === "before" ? `defect:${t.defectId}:before` : `defect:${t.defectId}:after:${t.round}`;
}

export function parseTarget(s: string | null | undefined): MediaTarget | null {
  const v = String(s ?? "");
  if (v === "progress") return { kind: "progress" };
  let m = /^task:(\d+)$/.exec(v);
  if (m) return { kind: "task", taskId: Number(m[1]) };
  m = /^defect:(\d+):before$/.exec(v);
  if (m) return { kind: "defect", defectId: Number(m[1]), side: "before", round: 0 };
  m = /^defect:(\d+):after:(\d+)$/.exec(v);
  if (m) return { kind: "defect", defectId: Number(m[1]), side: "after", round: Number(m[2]) };
  return null;
}

export interface MediaMeta { name: string; mime: string; size: number | null; area: string | null; note: string | null }

export interface MediaItemIn { key: string; meta: MediaMeta }

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

function keyOk(key: string, projectId: number): boolean {
  const prefix = `renovation/${projectId}/`;
  return key.startsWith(prefix) && key.length > prefix.length && !key.includes("..");
}

/** One uploaded file: its key must be in this project's store and its type a photo or a video. */
export function cleanMediaItem(x: unknown, projectId: number, shared: { area?: unknown; note?: unknown } = {}): BetaRefusal<MediaItemIn> {
  const o = (x ?? {}) as Json;
  const key = typeof o.key === "string" ? o.key.trim() : "";
  if (!keyOk(key, projectId)) return no("invalid_photo_key", "That photo does not belong to this project.");
  const mime = String(o.mime ?? "").split(";")[0].trim().toLowerCase();
  if (!MEDIA_TYPES[mime]) return no("bad_type", "Add photos or videos (MP4, MOV or WebM).");
  const size = Number(o.size);
  return {
    ok: true,
    value: {
      key,
      meta: {
        name: text(o.name, 200) ?? `file.${MEDIA_TYPES[mime]}`,
        mime,
        size: Number.isFinite(size) && size > 0 ? Math.round(size) : null,
        area: text(o.area ?? shared.area, MEDIA_AREA_MAX),
        note: text(o.note ?? shared.note, MEDIA_NOTE_MAX),
      },
    },
  };
}

/** A list of uploaded files (none is fine); refused whole when one is not acceptable. */
export function cleanMediaList(v: unknown, projectId: number, shared: { area?: unknown; note?: unknown } = {}): BetaRefusal<MediaItemIn[]> {
  if (v == null) return { ok: true, value: [] };
  if (!Array.isArray(v)) return no("media_invalid", "The photos were not sent as a list.");
  if (v.length > MEDIA_MAX_ITEMS) return no("too_many", `Add up to ${MEDIA_MAX_ITEMS} files at a time.`);
  const out: MediaItemIn[] = [];
  for (const x of v) {
    const one = cleanMediaItem(x, projectId, shared);
    if (!one.ok) return one;
    if (!out.some((y) => y.key === one.value.key)) out.push(one.value);
  }
  return { ok: true, value: out };
}

/** The meta JSON of a stored row; a row that cannot be read still shows, by its key. */
export function metaOf(note: unknown, key: string): MediaMeta {
  let o: Json = {};
  if (typeof note === "string" && note.startsWith("{")) {
    try { o = JSON.parse(note) as Json; } catch { o = {}; }
  } else if (note && typeof note === "object") o = note as Json;
  const name = text(o.name, 200) ?? key.split("/").pop() ?? "file";
  const mime = typeof o.mime === "string" ? o.mime : "";
  const size = Number(o.size);
  return { name, mime, size: Number.isFinite(size) && size > 0 ? size : null, area: text(o.area, MEDIA_AREA_MAX), note: text(o.note, MEDIA_NOTE_MAX) };
}

/** The rows to insert for a list, as JSON for jsonb_to_recordset(key text, meta text). */
export function mediaRowsJson(items: readonly MediaItemIn[]): string {
  return JSON.stringify(items.map((i) => ({ key: i.key, meta: JSON.stringify(i.meta) })));
}

/** The Timeline line for an upload. */
export function mediaActivityText(from: string | null, note: string | null): { title: string; body: string | null } {
  const t = parseTarget(from);
  const meta = metaOf(note, "");
  const what = meta.mime.startsWith("video/") ? "Video" : "Photo";
  const where = !t ? "" : t.kind === "progress" ? " from site" : t.kind === "task" ? " to a site step" : t.side === "before" ? " to a defect (before)" : " to a defect (after the fix)";
  return { title: `${what} added${where}`, body: [meta.area, meta.note].filter(Boolean).join(" · ") || null };
}

/* ---------- Site & photos: one list of every photo and video of the project ---------- */

export type PhotoCategory = "progress" | "do" | "gr" | "po" | "measure" | "defect";

export interface ProjectPhoto {
  id: string;
  /** The API path that streams it. */
  path: string;
  kind: MediaKind;
  name: string;
  /** ISO time it was taken or uploaded (to the minute or better); null when nothing says. */
  at: string | null;
  area: string | null;
  category: PhotoCategory;
  /** "POD", "Before", "After", the site step's name ... */
  label: string | null;
  /** The card it sits on in the timeline: one per document, defect, site step or measure; progress photos per upload. */
  group: { key: string; title: string };
  note: string | null;
}

/** Newest first, to the second; undated last in the order given. */
export function sortPhotos(list: ProjectPhoto[]): ProjectPhoto[] {
  const t = (p: ProjectPhoto): number => (p.at ? Date.parse(p.at) : NaN);
  return list.map((p, i) => ({ p, i })).sort((a, b) => {
    const x = t(a.p);
    const y = t(b.p);
    if (Number.isNaN(x) && Number.isNaN(y)) return a.i - b.i;
    if (Number.isNaN(x)) return 1;
    if (Number.isNaN(y)) return -1;
    return y - x || a.i - b.i;
  }).map((x) => x.p);
}
