/* Photos and videos in Beta: uploading a file to the project's store, recording progress / site step photos, and
   the project's whole photo list (GET /api/beta/projects/:id/photos). Server side: routes/renovationBeta.ts and
   services/renovation/betaMedia.ts. A video goes up with XMLHttpRequest and no deadline, so a slow phone network
   still finishes and the person sees it moving; a photo is shrunk on the phone first. */

import { api } from "../../api/client";
import { companyHeader } from "../../lib/activeCompany";
import { readAuthPass, readAuthToken } from "../../lib/authToken";
import { toUploadableImage } from "../../lib/heicToJpeg";
import { prepareImageForUpload } from "../../lib/imagePipeline";
import { uploadDocFile, type DocType } from "../../components/doc-attachments/docAttachmentsApi";
import { fileMime, type MediaItem, type MediaKind } from "./BetaMedia";

export type PhotoCategory = "progress" | "do" | "gr" | "po" | "measure" | "defect";

export interface ProjectPhoto {
  id: string;
  path: string;
  kind: MediaKind;
  name: string;
  at: string | null;
  area: string | null;
  category: PhotoCategory;
  label: string | null;
  group: { key: string; title: string };
  note: string | null;
}

export interface PhotoDocs { dos: Array<{ id: string; no: string }>; grs: Array<{ id: string; no: string }>; pos: Array<{ id: string; no: string }> }

export interface PhotosView {
  ready: boolean;
  areas: string[];
  photos: ProjectPhoto[];
  docs: PhotoDocs;
  tasks: Array<{ id: number; label: string; state: string }>;
}

/** What an uploaded file is recorded with. */
export interface UploadedMedia { key: string; name: string; mime: string; size: number }

const baseUrl = (import.meta.env.VITE_API_URL as string) || (import.meta.env.PROD ? "" : "https://conts-scm-engine.invalid");

function xhrUpload(path: string, body: Blob, mime: string, onProgress?: (f: number) => void): Promise<{ key: string }> {
  const token = readAuthToken();
  if (!token) return Promise.reject(new Error("Your session has expired. Please sign in again."));
  const pass = readAuthPass();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${baseUrl}${path}`);
    xhr.setRequestHeader("authorization", `Bearer ${token}`);
    if (pass) xhr.setRequestHeader("x-session-pass", pass);
    for (const [k, v] of Object.entries(companyHeader())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("content-type", mime);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* plain text */ }
      if (xhr.status >= 200 && xhr.status < 300 && typeof json.key === "string") resolve({ key: json.key });
      else reject(new Error(String(json.message ?? json.error ?? `Upload failed (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error("The upload did not reach the server. Check the connection and try again."));
    xhr.send(body);
  });
}

/** One photo or video into the project's store; the key it was saved under. */
export async function uploadProjectMedia(projectId: number, kind: string, file: File, onProgress?: (f: number) => void): Promise<UploadedMedia> {
  const mime = fileMime(file);
  const path = `/api/renovation/${projectId}/files?kind=${encodeURIComponent(kind)}`;
  if (mime.startsWith("video/")) {
    const { key } = await xhrUpload(path, file, mime, onProgress);
    return { key, name: file.name, mime, size: file.size };
  }
  const jpeg = await toUploadableImage(file);
  const small = (await prepareImageForUpload(jpeg)).file;
  const type = small.type || jpeg.type || "image/jpeg";
  const { key } = await api.postBinary<{ key: string }>(path, small, type);
  onProgress?.(1);
  return { key, name: file.name, mime: type, size: small.size };
}

/** One photo or video onto a site measure record (the record's own files, which the project page shows too). */
export async function uploadMeasureFile(projectId: number, recordId: number, file: File): Promise<void> {
  const mime = fileMime(file);
  const path = `/api/renovation/${projectId}/site-measures/${recordId}/files?fileName=${encodeURIComponent(file.name)}`;
  if (mime.startsWith("video/")) { await xhrUpload(path, file, mime); return; }
  const jpeg = await toUploadableImage(file);
  const small = (await prepareImageForUpload(jpeg)).file;
  await api.postBinary<{ id: number }>(path, small, small.type || jpeg.type || "image/jpeg");
}

/** Several files, one after another (a phone on site has one slow line). */
export async function uploadAll(projectId: number, kind: string, files: readonly File[], onProgress?: (done: number, total: number) => void): Promise<UploadedMedia[]> {
  const out: UploadedMedia[] = [];
  for (const [i, f] of files.entries()) {
    out.push(await uploadProjectMedia(projectId, kind, f));
    onProgress?.(i + 1, files.length);
  }
  return out;
}

export const betaMediaApi = {
  photos: (projectId: number): Promise<PhotosView> => api.get<PhotosView>(`/api/beta/projects/${projectId}/photos`),
  /** Progress photos (target "progress") or a site step's ("task:<id>"). */
  record: (projectId: number, b: { target: string; items: UploadedMedia[]; area?: string | null; note?: string | null }): Promise<{ ok: true; added: number }> =>
    api.post<{ ok: true; added: number }>(`/api/beta/projects/${projectId}/media`, b),
  /** Onto a DO, GR or PO, the same storage those documents' own screens use, so the photo shows there too. */
  attachToDoc: async (type: Extract<DocType, "delivery_order" | "goods_received" | "purchase_order">, docId: string, files: readonly File[], caption?: string): Promise<number> => {
    let n = 0;
    for (const f of files) {
      await uploadDocFile(type, docId, f, caption ? { caption } : {});
      n++;
    }
    return n;
  },
};

/** A project photo as the shared media tiles take it. */
export function asMedia(p: ProjectPhoto): MediaItem {
  // Only the short marks sit on a tile; a site step's name is already the card's title.
  return { id: p.id, path: p.path, kind: p.kind, name: p.name, label: p.category === "progress" ? null : p.label, at: p.at, caption: [p.area, p.note].filter(Boolean).join(" · ") || null };
}
