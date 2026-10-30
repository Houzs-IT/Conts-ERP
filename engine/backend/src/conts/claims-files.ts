// Conts only (not part of Houzs's code): the photos and PDFs on staff receipts and payment requests (design
// docs/superpowers/specs/2026-10-28-payment-requests-petty-cash-design.md §4.4). Files are checked and stored before any
// row is written, so a failed upload never leaves a receipt behind with nothing on it.
import { DOC_FILE_MIMES, MAX_DOC_FILE_BYTES, decodeBase64 } from '../scm/lib/doc-files';

/* eslint-disable @typescript-eslint/no-explicit-any -- the R2 binding and the PostgREST client, untyped as in doc-files.ts */
export const MAX_FILES = 8;
/** All files on one receipt or request together: base64 JSON is held in the Worker's memory at once. */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export type Decoded = { name: string; mime: string; bytes: Uint8Array };

/** The files a person sent, checked; or the message saying what is wrong. */
export function decodeFiles(raw: unknown, what: string): { ok: true; files: Decoded[] } | { ok: false; status: 400 | 422; error: string; message: string } {
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  if (list.length === 0 || list.length > MAX_FILES) return { ok: false, status: 422, error: 'validation', message: `Add ${what} (up to ${MAX_FILES} files).` };
  const out: Decoded[] = [];
  let total = 0;
  for (const f of list) {
    const mime = String(f.mime ?? '');
    const bytes = decodeBase64(String(f.dataBase64 ?? ''));
    if (!DOC_FILE_MIMES.has(mime) || !bytes || bytes.byteLength === 0) return { ok: false, status: 400, error: 'bad_type', message: 'Photos (JPEG, PNG, WebP) or a PDF only.' };
    if (bytes.byteLength > MAX_DOC_FILE_BYTES) return { ok: false, status: 400, error: 'bad_size', message: 'Each file must be under 20 MB.' };
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) return { ok: false, status: 400, error: 'bad_size', message: 'The files together must be under 25 MB. Send fewer or smaller photos.' };
    out.push({ name: String(f.name ?? 'file').slice(0, 200), mime, bytes });
  }
  return { ok: true, files: out };
}

/** Stores the files under `prefix/<uuid>.<ext>` and returns the rows to record. */
export async function storeFiles(bucket: any, prefix: string, files: Decoded[]): Promise<Array<{ r2_key: string; file_name: string; mime: string; byte_size: number }>> {
  const rows = [];
  for (const f of files) {
    const key = `${prefix}/${crypto.randomUUID()}.${EXT[f.mime]}`;
    await bucket.put(key, f.bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: f.mime } });
    rows.push({ r2_key: key, file_name: f.name, mime: f.mime, byte_size: f.bytes.byteLength });
  }
  return rows;
}

/** Best effort: files of a receipt or request that was not saved after all. */
export async function removeFiles(bucket: any, keys: string[]): Promise<void> {
  for (const k of keys) { try { await bucket.delete(k); } catch { /* an orphan file is harmless; the row never existed */ } }
}

/** A stored file as the response, with a file name any language can carry. */
export function fileResponse(obj: { body: unknown }, fileName: string, mime: string): Response {
  const ascii = String(fileName).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return new Response(obj.body as BodyInit, {
    headers: {
      'content-type': mime,
      'content-disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'private, max-age=300',
    },
  });
}
