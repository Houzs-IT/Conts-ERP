/* 2D as a set of sheets (owner, 24 Oct 2026; migration 0149), and 3D as a set of named links (migration 0155).
   A version either holds sheets or links (the first set, or only the ones that changed) or is one file from before
   sets existed. The set a version stands for: walk the versions from V1 up to it; a sheet version lays its sheets
   over the set before it, by name.
   A one-file version: in 2D it replaces everything (a whole drawing set in one PDF), and the next sheet version
   starts a new set. In 3D it is one named link or file and is laid over the set by its name like any other, so links
   added one by one before 0155 still make up one set (owner, live run 24 Oct 2026: "the approved 3D set keeps only
   the last link").
   A removed sheet (migration 0153) is left out of every set and of the set PDF, but its files stay, listed by
   removedSheetsOf, and it can be put back. */

import { api } from "../../api/client";
import type { DesignFile } from "../projects/renovation/simpleApi";

export type SheetKind = "2d" | "3d";

export interface BetaSheet {
  id: number; fileId: number; name: string; fileName: string; contentType: string | null; size: number | null;
  /** The stored file; null for a 3D link. */
  key: string | null;
  uploadedAt: string;
  /** A 3D link's address (0155). */
  url?: string | null;
  /** When the sheet was removed from the set; null or absent while it is in it. */
  removedAt?: string | null;
}

/** One sheet of a set as of a version: the file shown now, and every file it had up to that version (newest first). */
export interface SetSheet {
  name: string;
  /** The R2 key to open, or null for a link. */
  key: string | null;
  url: string | null;
  fileName: string;
  contentType: string | null;
  size: number | null;
  /** The version this file came in with. */
  version: number;
  /** A row of project_design_sheets (it can be renamed, removed, replaced on its own); false for a one-file version. */
  fromSheet: boolean;
  history: Array<{ version: number; key: string | null; url: string | null; fileName: string; uploadedOn: string }>;
}

const nameKey = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

export function sheetSetAt(files: readonly DesignFile[], sheets: readonly BetaSheet[], version: number, kind: SheetKind = "2d"): SetSheet[] {
  const versions = files.filter((f) => f.kind === kind && f.version <= version).sort((a, b) => a.version - b.version || a.id - b.id);
  const byFile = new Map<number, BetaSheet[]>();
  for (const s of sheets) byFile.set(s.fileId, [...(byFile.get(s.fileId) ?? []), s]);
  let set = new Map<string, SetSheet>();
  let fromOneFile = false;
  for (const f of versions) {
    const own = (byFile.get(f.id) ?? []).sort((a, b) => a.id - b.id);
    if (own.length === 0) {
      const k = nameKey(f.file_name);
      const entry = { version: f.version, key: f.r2_key, url: f.external_url, fileName: f.file_name, uploadedOn: f.submitted_on ?? f.uploaded_at };
      const one: SetSheet = {
        name: f.file_name, key: f.r2_key, url: f.external_url, fileName: f.file_name, contentType: f.content_type ?? null, size: f.size_bytes ?? null,
        version: f.version, fromSheet: false, history: [entry, ...(kind === "3d" ? set.get(k)?.history ?? [] : [])],
      };
      if (kind === "3d") set.set(k, one);
      else { set = new Map([[k, one]]); fromOneFile = true; }
      continue;
    }
    if (fromOneFile) { set = new Map(); fromOneFile = false; }
    for (const s of own) {
      // A removed sheet's version still counts as a sheet version above; only the sheet itself is left out.
      if (s.removedAt) continue;
      const k = nameKey(s.name);
      const before = set.get(k);
      const url = s.url ?? null;
      const entry = { version: f.version, key: s.key, url, fileName: s.fileName, uploadedOn: f.submitted_on ?? f.uploaded_at };
      // Replacing a sheet keeps its place in the set; a new sheet goes at the end.
      set.set(k, {
        name: s.name, key: s.key, url, fileName: s.fileName, contentType: s.contentType, size: s.size, version: f.version, fromSheet: true,
        history: [entry, ...(before?.history ?? [])],
      });
    }
  }
  return [...set.values()];
}

/** Per sheet of a set, whether it differs from the approved set: a new file, or a sheet the approved set did not have. */
export function changedAgainst(set: readonly SetSheet[], approved: readonly SetSheet[] | null): Map<string, boolean> {
  const before = new Map((approved ?? []).map((s) => [nameKey(s.name), s]));
  return new Map(set.map((s) => {
    const a = before.get(nameKey(s.name));
    return [s.name, approved == null ? false : !a || a.key !== s.key || a.url !== s.url];
  }));
}

/** The removed sheets of a kind, one per name, with every file each had (newest first). A name uploaded again since is
 *  a sheet of the set once more, so it is not listed. */
export function removedSheetsOf(files: readonly DesignFile[], sheets: readonly BetaSheet[], kind: SheetKind = "2d"): Array<{ name: string; removedAt: string; history: Array<{ version: number; key: string | null; url: string | null; fileName: string }> }> {
  const ofKind = new Map(files.filter((f) => f.kind === kind).map((f) => [f.id, f.version]));
  const mine = sheets.filter((s) => ofKind.has(s.fileId));
  const out = new Map<string, { name: string; removedAt: string; history: Array<{ version: number; key: string | null; url: string | null; fileName: string }> }>();
  const live = new Set(mine.filter((s) => !s.removedAt).map((s) => nameKey(s.name)));
  for (const s of [...mine].sort((a, b) => b.id - a.id)) {
    if (!s.removedAt) continue;
    const k = nameKey(s.name);
    if (live.has(k)) continue;
    const e = out.get(k) ?? { name: s.name, removedAt: s.removedAt, history: [] };
    e.history.push({ version: ofKind.get(s.fileId) ?? 0, key: s.key, url: s.url ?? null, fileName: s.fileName });
    out.set(k, e);
  }
  return [...out.values()];
}

/** A sheet's name from its file name: the name as it is, without the extension (owner, 24 Oct 2026). It can be renamed. */
export function sheetNameOf(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().slice(0, 120) || "Sheet";
}

/** Where a 3D link points, said the way people know it ("Kuula", "Google Drive"), else the bare host. */
export function linkHost(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "Link"; }
  const known: Array<[RegExp, string]> = [
    [/(^|\.)kuula\.co$/, "Kuula"], [/(^|\.)matterport\.com$/, "Matterport"], [/^drive\.google\.com$|^docs\.google\.com$/, "Google Drive"],
    [/(^|\.)dropbox\.com$/, "Dropbox"], [/(^|\.)sketchfab\.com$/, "Sketchfab"], [/(^|\.)coohom\.com$/, "Coohom"], [/(^|\.)kujiale\.com$/, "Kujiale"],
    [/(^|\.)planner5d\.com$/, "Planner 5D"], [/(^|\.)onedrive\.live\.com$|1drv\.ms$|sharepoint\.com$/, "OneDrive"], [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  ];
  return known.find(([re]) => re.test(host))?.[1] ?? host;
}

/** "13.4 MB" from bytes; null when no size is known. */
export function sizeText(bytes: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface UploadedSheet { key: string; fileName: string; contentType: string; size: number }

const B = "/api/beta";
export const sheetsApi = {
  list: (projectId: number): Promise<{ ready: boolean; canRemove?: boolean; canLink?: boolean; sheets: BetaSheet[] }> => api.get(`${B}/projects/${projectId}/design-sheets`),
  remove: (projectId: number, name: string, kind: SheetKind = "2d"): Promise<{ ok: true; name: string }> =>
    api.post(`${B}/projects/${projectId}/design-sheets/remove`, { name, kind }),
  restore: (projectId: number, name: string, kind: SheetKind = "2d"): Promise<{ ok: true; name: string }> =>
    api.post(`${B}/projects/${projectId}/design-sheets/restore`, { name, kind }),
  rename: (projectId: number, name: string, newName: string, kind: SheetKind = "2d"): Promise<{ ok: true; name: string }> =>
    api.post(`${B}/projects/${projectId}/design-sheets/rename`, { name, newName, kind }),
  uploadFile: (projectId: number, file: File): Promise<UploadedSheet> =>
    api.postBinary<UploadedSheet>(`${B}/projects/${projectId}/sheet-files?fileName=${encodeURIComponent(file.name)}`, file, file.type || "application/octet-stream"),
  saveVersion: (projectId: number, b: { submittedOn: string; personIds: number[]; note: string | null; sheets: Array<UploadedSheet & { name: string }> }): Promise<{ id: number; version: number }> =>
    api.post(`${B}/projects/${projectId}/design-2d-sets`, b),
  saveLinks: (projectId: number, b: { submittedOn: string; personIds: number[]; nextPersonId: number | null; note: string | null; links: Array<{ name: string; url: string }> }): Promise<{ id: number; version: number }> =>
    api.post(`${B}/projects/${projectId}/design-3d-links`, b),
};
