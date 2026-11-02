/* Photos and documents on every document of the transaction flow (owner, 16 Oct 2026; migration 0119). The
   server side is engine/backend/src/scm/routes/doc-attachments.ts: each document answers on its own prefix, so the
   document's own access rules decide who may look and who may add or remove. */

import { authedFetch, API_URL } from '../../vendor/scm/lib/authed-fetch';
import { readAuthPass, readAuthToken } from '../../lib/authToken';
import { companyHeader } from '../../lib/activeCompany';
import { prepareImageForUpload } from '../../lib/imagePipeline';

export type DocType =
  | 'quotation' | 'sales_order' | 'variation_order' | 'purchase_order' | 'delivery_order' | 'goods_received'
  | 'delivery_return' | 'purchase_return' | 'purchase_invoice' | 'sales_invoice' | 'receipt'
  | 'credit_note' | 'official_receipt' | 'deposit_invoice' | 'payment_voucher' | 'ap_invoice';

export interface DocFile {
  id: string;
  name: string;
  mime: string;
  kind: 'image' | 'video' | 'pdf' | 'file';
  size: number;
  caption: string;
  source: 'upload' | 'import' | 'legacy' | 'pod' | 'evidence';
  by: string | null;
  at: string;
  /** The line it is on; null for the whole document. */
  lineId: string | null;
  /** Shown here, kept elsewhere: a delivery's proof-of-delivery photo, a voucher's bill, or a file on the line upstream. */
  readOnly: boolean;
  /** For a file carried from upstream: where it is kept, e.g. "Sales order SO-2610-0003". */
  from?: string;
}

export interface LineFiles { id: string; lineNo: number; sku: string; description: string; files: DocFile[] }

export interface DocFilesResponse { ready: boolean; doc?: { type: DocType; id: string; no: string }; files: DocFile[]; lines?: LineFiles[] }

export const DOC_LABEL: Record<DocType, string> = {
  quotation: 'Quotation', sales_order: 'Sales order', variation_order: 'Variation order', purchase_order: 'Purchase order',
  delivery_order: 'Delivery order', goods_received: 'Goods received', delivery_return: 'Delivery return',
  purchase_return: 'Purchase return', purchase_invoice: 'Purchase invoice', sales_invoice: 'Sales invoice', receipt: 'Receipt',
  credit_note: 'Credit / debit note', official_receipt: 'Official receipt', deposit_invoice: 'Deposit invoice',
  payment_voucher: 'Payment voucher', ap_invoice: 'AP invoice',
};

/* Where each document lives under /api/scm, and its page in the app. */
const PREFIX: Record<DocType, string> = {
  quotation: '/renovation/quotations', sales_order: '/mfg-sales-orders', variation_order: '/renovation/variation-orders',
  purchase_order: '/mfg-purchase-orders', delivery_order: '/delivery-orders-mfg', goods_received: '/grns',
  delivery_return: '/delivery-returns', purchase_return: '/purchase-returns', purchase_invoice: '/purchase-invoices',
  sales_invoice: '/sales-invoices', receipt: '/receipts', credit_note: '/credit-notes', official_receipt: '/accounting/receipts',
  deposit_invoice: '/deposit-invoices', payment_voucher: '/payment-vouchers', ap_invoice: '/ap-invoices',
};

export function docPagePath(type: DocType, id: string): string {
  const e = encodeURIComponent(id);
  switch (type) {
    case 'quotation': return `/scm/renovation/quotations/${e}`;
    case 'sales_order': return `/scm/sales-orders/${e}`;
    case 'variation_order': return `/scm/renovation/variation-orders/${e}`;
    case 'purchase_order': return `/scm/purchase-orders/${e}`;
    case 'delivery_order': return `/scm/delivery-orders/${e}`;
    case 'goods_received': return `/scm/grns/${e}`;
    case 'delivery_return': return `/scm/delivery-returns/${e}`;
    case 'purchase_return': return `/scm/purchase-returns/${e}`;
    case 'purchase_invoice': return `/scm/purchase-invoices/${e}`;
    case 'sales_invoice': return `/scm/sales-invoices/${e}`;
    case 'receipt': return '/scm/receipts';
    case 'credit_note': return '/scm/credit-notes';
    case 'official_receipt': return '/scm/official-receipts';
    case 'deposit_invoice': return '/scm/deposit-invoices';
    case 'payment_voucher': return `/scm/payment-vouchers/${e}`;
    case 'ap_invoice': return '/scm/ap-invoices';
  }
}

const base = (type: DocType, id: string) => `${PREFIX[type]}/${encodeURIComponent(id)}/attachments`;
/** The path api.fetchBlobUrl / MediaLightbox stream a file from (its last segment is the file id). */
export const filesBaseUrl = (type: DocType, id: string) => `/api/scm${base(type, id)}`;

export const ACCEPT = 'image/*,video/*,application/pdf,.heic,.heif';
export const MAX_FILE_MB = 25;
export const MAX_VIDEO_MB = 95;

export const docFilesKey = (type: DocType, id: string) => ['doc-attachments', type, id] as const;

/** A line as people know it: "Line 2 · TILE-600 Floor tile". */
export const lineLabel = (l: Pick<LineFiles, 'lineNo' | 'sku' | 'description'>) =>
  [`Line ${l.lineNo}`, [l.sku, l.description && l.description !== l.sku ? l.description : ''].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

export async function listDocFiles(type: DocType, id: string): Promise<DocFilesResponse> {
  try {
    return await authedFetch<DocFilesResponse>(base(type, id));
  } catch (e) {
    /* Before migration 0119 every call answers 409 not_ready: the panel says so instead of failing. */
    if (/not switched on|not_ready/i.test(String((e as Error | null)?.message ?? e))) return { ready: false, files: [] };
    throw e;
  }
}

export const setCaption = (type: DocType, id: string, fileId: string, caption: string) =>
  authedFetch<{ ok: true }>(`${base(type, id)}/${encodeURIComponent(fileId)}`, { method: 'PATCH', body: JSON.stringify({ caption }) });

export const removeDocFile = (type: DocType, id: string, fileId: string) =>
  authedFetch<{ ok: true }>(`${base(type, id)}/${encodeURIComponent(fileId)}`, { method: 'DELETE' });

/** The browser's type for a file, with the phone formats some browsers leave blank. */
export function mimeOf(file: File): string {
  const t = (file.type || '').toLowerCase();
  if (t) return t === 'image/jpg' ? 'image/jpeg' : t;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ({ heic: 'image/heic', heif: 'image/heif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' } as Record<string, string>)[ext] ?? '';
}

/** Why a file cannot be attached, or null when it can. */
export function refusal(file: File): string | null {
  const m = mimeOf(file);
  const video = /^video\/(mp4|quicktime|webm|3gpp)$/.test(m);
  const ok = video || /^image\/(jpeg|png|webp|gif|heic|heif)$/.test(m) || m === 'application/pdf';
  if (!ok) return `${file.name}: only photos, videos and PDFs can be attached.`;
  const cap = video ? MAX_VIDEO_MB : MAX_FILE_MB;
  if (file.size > cap * 1024 * 1024) return `${file.name} is over ${cap} MB.`;
  return null;
}

/** The file's SHA-256: the same file attached twice to one document is recognised (the import relies on it). */
export async function sha256Of(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadResult { ok: true; duplicate: boolean; id?: string; message?: string }

/* XHR rather than fetch: a phone video takes a while and the person should see it moving. The raw bytes are the
   body (no base64, no multipart), so the server streams them straight into storage. */
export async function uploadDocFile(
  type: DocType, id: string, file: File,
  opts: { caption?: string; source?: 'upload' | 'import' | 'pod'; sha256?: string; lineId?: string | null; onProgress?: (fraction: number) => void } = {},
): Promise<UploadResult> {
  const sha256 = opts.sha256 ?? (await sha256Of(file));
  const mime = mimeOf(file);
  /* Phone photos are shrunk to a sensible size first (the same step line photos use); the fingerprint is the
     original's, so the same photo is still recognised. */
  const body = mime.startsWith('image/') ? (await prepareImageForUpload(file)).file : file;
  const sendMime = body === file ? mime : (body.type || mime);
  const q = new URLSearchParams({ name: file.name, sha256, source: opts.source ?? 'upload' });
  if (opts.caption) q.set('caption', opts.caption);
  if (opts.lineId) q.set('lineId', opts.lineId);
  const token = readAuthToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  const pass = readAuthPass();
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_URL}${base(type, id)}?${q.toString()}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    if (pass) xhr.setRequestHeader('x-session-pass', pass);
    for (const [k, v] of Object.entries(companyHeader())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('content-type', sendMime);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try { json = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { /* plain text answer */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as unknown as UploadResult);
      else reject(new Error(String(json.message ?? json.error ?? `Upload failed (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error('The upload did not reach the server. Check the connection and try again.'));
    xhr.send(body);
  });
}

export function formatSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatWhen(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
