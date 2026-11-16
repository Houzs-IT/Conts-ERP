import { MEDIA_ACTION, MEDIA_IMAGE_MAX_BYTES, mediaRowsJson, targetCode, type MediaItemIn, type MediaMeta, type MediaTarget } from "./betaMedia";
import type { Db } from "./load";

export const PROOF_MIN_PHOTOS = 1;
export const PROOF_MAX_PHOTOS = 10;

const PROOF_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};

export interface ProofPhoto {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ProofBucket {
  put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }): Promise<unknown>;
}

export interface LineProof {
  photos: readonly ProofPhoto[];
  bucket: ProofBucket;
  by: string;
}

export interface ProofStageMeta {
  stage: "start" | "progress" | "finish";
  doneQty?: number;
}

export interface ProofItem {
  key: string;
  meta: MediaMeta & ProofStageMeta;
}

export type ProofRefusal = { error: "photo_required" | "photo_invalid"; message: string };

const refuse = (error: ProofRefusal["error"], message: string): ProofRefusal => ({ error, message });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function decodeBase64(data: string): Uint8Array | null {
  try {
    const binary = atob(data);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodedLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export function parseProofPhotos(value: unknown): ProofPhoto[] | ProofRefusal {
  const list = Array.isArray(value) ? value : [];
  if (list.length < PROOF_MIN_PHOTOS) return refuse("photo_required", "Add at least one photo of the work.");
  if (list.length > PROOF_MAX_PHOTOS) return refuse("photo_invalid", `Add up to ${PROOF_MAX_PHOTOS} photos at a time.`);
  const photos: ProofPhoto[] = [];
  for (const item of list) {
    const entry = isRecord(item) ? item : {};
    const mime = typeof entry.mime === "string" ? entry.mime.split(";")[0].trim().toLowerCase() : "";
    if (!PROOF_TYPES[mime]) return refuse("photo_invalid", "Photos must be JPEG, PNG, WebP or HEIC pictures.");
    const data = typeof entry.dataBase64 === "string" ? entry.dataBase64 : "";
    if (!data || decodedLength(data) > MEDIA_IMAGE_MAX_BYTES) return refuse("photo_invalid", `Each photo must be under ${MEDIA_IMAGE_MAX_BYTES / 1024 / 1024} MB.`);
    const bytes = decodeBase64(data);
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MEDIA_IMAGE_MAX_BYTES) return refuse("photo_invalid", "A photo could not be read. Take it again.");
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 200) : "";
    photos.push({ name: name || `proof.${PROOF_TYPES[mime]}`, mime, bytes });
  }
  return photos;
}

export const isProofRefusal = (value: ProofPhoto[] | ProofRefusal): value is ProofRefusal => !Array.isArray(value);

export async function storeProofFiles(proof: LineProof, projectId: number, stageMeta: ProofStageMeta): Promise<ProofItem[]> {
  const items: ProofItem[] = [];
  for (const photo of proof.photos) {
    const key = `renovation/${projectId}/proof-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${PROOF_TYPES[photo.mime]}`;
    await proof.bucket.put(key, photo.bytes, { httpMetadata: { contentType: photo.mime } });
    items.push({ key, meta: { name: photo.name, mime: photo.mime, size: photo.bytes.byteLength, area: null, note: null, by: proof.by, ...stageMeta } });
  }
  return items;
}

export async function writeProofRows(db: Db, projectId: number, companyId: number, target: MediaTarget, items: readonly MediaItemIn[]): Promise<number> {
  const from = targetCode(target);
  await db.prepare(
    `INSERT INTO project_activity (project_id, action, from_value, to_value, note, user_id, company_id)
     SELECT ?::bigint, '${MEDIA_ACTION}', ?::text, x.key, x.meta, NULL, ?::bigint FROM jsonb_to_recordset(?::text::jsonb) AS x(key text, meta text)`,
  ).bind(projectId, from, companyId, mediaRowsJson(items)).run();
  const row = await db.prepare(
    `SELECT count(*)::int AS photo_count FROM project_activity WHERE project_id = ? AND action = '${MEDIA_ACTION}' AND from_value = ? AND archived_at IS NULL`,
  ).bind(projectId, from).first<{ photo_count: number }>();
  return Number(row?.photo_count ?? items.length);
}
