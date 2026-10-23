/* 2D as a set of sheets (owner, 24 Oct 2026; migration 0149). A 2D version either holds sheets (the first set, or only
   the sheets that changed) or is one file from before sheets existed. The set a version stands for: walk the versions
   from V1 up to it; a one-file version replaces everything; a sheet version lays its sheets over the set before it,
   by sheet name, unless the set before it was a one-file version, which it then replaces. */

import { api } from "../../api/client";
import type { DesignFile } from "../projects/renovation/simpleApi";

export interface BetaSheet { id: number; fileId: number; name: string; fileName: string; contentType: string | null; size: number | null; key: string; uploadedAt: string }

/** One sheet of a set as of a version: the file shown now, and every file it had up to that version (newest first). */
export interface SetSheet {
  name: string;
  /** The R2 key to open, or null for a one-file version given as a link. */
  key: string | null;
  url: string | null;
  fileName: string;
  contentType: string | null;
  /** The version this file came in with. */
  version: number;
  history: Array<{ version: number; key: string | null; url: string | null; fileName: string }>;
}

const nameKey = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

export function sheetSetAt(files: readonly DesignFile[], sheets: readonly BetaSheet[], version: number): SetSheet[] {
  const versions = files.filter((f) => f.kind === "2d" && f.version <= version).sort((a, b) => a.version - b.version || a.id - b.id);
  const byFile = new Map<number, BetaSheet[]>();
  for (const s of sheets) byFile.set(s.fileId, [...(byFile.get(s.fileId) ?? []), s]);
  let set = new Map<string, SetSheet>();
  let fromOneFile = false;
  for (const f of versions) {
    const own = (byFile.get(f.id) ?? []).sort((a, b) => a.id - b.id);
    if (own.length === 0) {
      set = new Map([[nameKey(f.file_name), {
        name: f.file_name, key: f.r2_key, url: f.external_url, fileName: f.file_name, contentType: null, version: f.version,
        history: [{ version: f.version, key: f.r2_key, url: f.external_url, fileName: f.file_name }],
      }]]);
      fromOneFile = true;
      continue;
    }
    if (fromOneFile) { set = new Map(); fromOneFile = false; }
    for (const s of own) {
      const k = nameKey(s.name);
      const before = set.get(k);
      const entry = { version: f.version, key: s.key, url: null, fileName: s.fileName };
      // Replacing a sheet keeps its place in the set; a new sheet goes at the end.
      set.set(k, { name: s.name, key: s.key, url: null, fileName: s.fileName, contentType: s.contentType, version: f.version, history: [entry, ...(before?.history ?? [])] });
    }
  }
  return [...set.values()];
}

/** A sheet's name from its file name: no extension, separators read as spaces. */
export function sheetNameOf(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Sheet";
}

export interface UploadedSheet { key: string; fileName: string; contentType: string; size: number }

const B = "/api/beta";
export const sheetsApi = {
  list: (projectId: number): Promise<{ ready: boolean; sheets: BetaSheet[] }> => api.get(`${B}/projects/${projectId}/design-sheets`),
  uploadFile: (projectId: number, file: File): Promise<UploadedSheet> =>
    api.postBinary<UploadedSheet>(`${B}/projects/${projectId}/sheet-files?fileName=${encodeURIComponent(file.name)}`, file, file.type || "application/octet-stream"),
  saveVersion: (projectId: number, b: { submittedOn: string; personIds: number[]; note: string | null; sheets: Array<UploadedSheet & { name: string }> }): Promise<{ id: number; version: number }> =>
    api.post(`${B}/projects/${projectId}/design-2d-sets`, b),
};
