import type { ApiError } from './types';
import { clearSnapshots, saveSnapshot } from './snapshots';

// Fields written out rather than as constructor parameter properties, so Node can load this file for tests (type
// stripping does not support those).
export class ApiFailure extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  body?: unknown;
  constructor(
    status: number,
    code: string,
    /** Already user-safe. Render it directly — see api.md conventions. */
    message: string,
    fields?: Record<string, string>,
    body?: unknown,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.body = body;
  }
}

/** Plain-English fallbacks by error code, used when the server sent no message or a technical one. */
const CODE_MESSAGE: Record<string, string> = {
  UNAUTHENTICATED: 'Your session has ended. Sign in again to continue.',
  FORBIDDEN: 'Your account is not allowed to do this. Ask management if you need it.',
  WRONG_DOOR: 'This account signs in somewhere else. Use the link you were given.',
  NOT_FOUND: 'That record could not be found. It may have been removed; refresh the page.',
  CONFLICT: 'This changed while you were looking at it. Refresh and try again.',
  VALIDATION: 'Some details are missing or not valid. Check the form and try again.',
  RATE_LIMITED: 'Too many tries in a short time. Wait a minute and try again.',
  NOT_CONFIGURED: 'This is not set up on this system yet. Ask IT to connect it.',
  NOT_LINKED: 'This unit is not linked to the channel manager yet.',
  INTERNAL: 'Something went wrong on our side. Refresh the page to see whether it was saved before trying again; if it keeps happening, tell IT.',
  NETWORK: 'Could not reach the server. Check your internet connection and try again.',
};

/** Fallback by HTTP status, in words. The number itself is never shown. */
function statusMessage(status: number): string {
  if (status === 401) return CODE_MESSAGE.UNAUTHENTICATED;
  if (status === 403) return CODE_MESSAGE.FORBIDDEN;
  if (status === 404) return CODE_MESSAGE.NOT_FOUND;
  if (status === 409) return CODE_MESSAGE.CONFLICT;
  if (status === 413) return 'That file is too large. Choose a smaller one.';
  if (status === 400 || status === 422) return CODE_MESSAGE.VALIDATION;
  if (status === 429) return CODE_MESSAGE.RATE_LIMITED;
  if (status === 502 || status === 503 || status === 504) return 'The server is busy or restarting. Wait a moment and try again.';
  if (status >= 500) return CODE_MESSAGE.INTERNAL;
  return 'That did not work. Try again in a moment.';
}

/** Database errors, stack traces and platform errors read as gibberish to the people using this app. */
const TECHNICAL = /\b(?:SQL|SELECT\s|INSERT\s|UPDATE\s+\w+\s+SET|DELETE\s+FROM|relation\s+"|column\s+"|violates|constraint|syntax error|duplicate key|null value in|TypeError|ReferenceError|SyntaxError|RangeError|Unexpected token|is not a function|is not defined|Cannot read propert|ECONNREFUSED|ETIMEDOUT|fetch failed|Worker exceeded|exceeded resource|Internal Server Error|Bad Gateway|Service Unavailable|postgres|Hyperdrive|D1_ERROR|stack trace|undefined|NaN)\b|\[object Object\]|<\/?[a-z]+[\s>]|\bat\s+\S+\s+\(|\.(?:ts|js|mjs):\d+/i;

/** The sentence a person sees for a failed request: the server's own message when it is written for people, with
 *  any status number taken out, otherwise a plain fallback for the error code or status. */
export function friendlyMessage(status: number, code: string | undefined, message: string | undefined): string {
  const cleaned = (message ?? '')
    .replace(/\s*\((?:status|HTTP|code)?\s*\d{3}\)/gi, '')
    .replace(/\s*\b(?:status|HTTP)\s*\d{3}\b/gi, '')
    .trim();
  if (cleaned && !TECHNICAL.test(cleaned) && cleaned.length <= 400) return cleaned;
  return (code && CODE_MESSAGE[code]) || statusMessage(status);
}

/** The last answer to each GET a screen read through useApi, so going back to a page shows its figures at once while
 *  they are re-read, instead of empty boxes. Any write (including sign-in, sign-out and view-as) empties it, so a
 *  screen never shows data from before a change it might have made. Capped so a long session does not grow it. */
export const readCache = new Map<string, unknown>();
const READ_CACHE_MAX = 80;
const answeredAt = new Map<string, number>();
/** How many writes have started or finished in this tab. A read notes it when it is sent: if it has moved by the time
 *  the answer lands, a write ran in between and the answer may be from before it, so it is not kept (a screen opened
 *  after the save would otherwise show the old figures as if fresh). Moved when a write starts and again when it ends,
 *  so a read sent while a write is on its way does not count either. */
let writes = 0;
export const writeCount = () => writes;
/** Other tabs of this browser hear of each write, so a read one of them sent before it is not kept either (its
 *  snapshot would otherwise come back on the next visit as if it were current). */
const writesElsewhere: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('conts-writes') : null;
if (writesElsewhere) {
  writesElsewhere.onmessage = () => forgetAll(false);
  // Node (the tests) would otherwise stay running for it.
  (writesElsewhere as BroadcastChannel & { unref?: () => void }).unref?.();
}
function forgetAll(stored: boolean) { writes++; readCache.clear(); answeredAt.clear(); clearSnapshots({ stored }); }
/** A write started or finished: everything kept may be out of date, the saved snapshots (lib/snapshots.ts) included. */
export function wrote() { forgetAll(true); try { writesElsewhere?.postMessage(1); } catch { /* closed */ } }
/** Reads answered with Cache-Control: no-store. Never kept as a snapshot. */
const noStore = new Set<string>();
/** Keeps a read's answer. `sentAt` is writeCount() when the read was sent; an answer sent before the latest write is
 *  not kept. The main screens' reads are also kept as a snapshot for the next visit (lib/snapshots.ts decides which). */
export function remember(path: string, data: unknown, sentAt?: number) {
  if (sentAt !== undefined && sentAt !== writes) return;
  readCache.delete(path);
  readCache.set(path, data);
  answeredAt.set(path, Date.now());
  if (sentAt !== undefined && !noStore.has(path)) saveSnapshot(path, data);
  if (readCache.size > READ_CACHE_MAX) { const oldest = readCache.keys().next().value!; readCache.delete(oldest); answeredAt.delete(oldest); }
}
/** True when the kept answer for this read arrived within the last `ms` (and no write has emptied the cache since):
 *  a screen opened or a tab switched back that soon shows it without asking the server again. */
export function answeredWithin(path: string, ms: number): boolean {
  const at = answeredAt.get(path);
  return readCache.has(path) && at !== undefined && Date.now() - at < ms;
}

const RETRY_STATUS = new Set([502, 503, 504]);
/** A read is also tried again after a plain 500: it saved nothing, and a burst of reads (moving quickly between pages)
 *  can meet a database hiccup that the next try does not (polish 1: Units showed an empty tree until a reload). */
const RETRY_READ_STATUS = new Set([500, 502, 503, 504]);

/** True for a request the browser or the page cancelled (an AbortController, a page being left): not a failure, so
 *  nothing should show an error for it. */
export const isAbort = (e: unknown): boolean =>
  (e instanceof DOMException || e instanceof Error) && e.name === 'AbortError';

/** Money and document writes: payments, payouts, statements, expenses, credit notes, guest documents, owner adjustments
 *  (deductions). And every form that creates a record, where a second copy is as bad as a second payment: a
 *  reservation, a block, a cleaning job, a maintenance job, a receipt or payment request (claims), an owner, a unit, a
 *  contract, a guest. The server honours the key on every write (functions/api/_middleware.ts, once()). */
const ONCE = /^\/(reservations(\/[^/]+\/payments(\/[^/]+)?)?|payouts(\/run)?|statements\/(generate|finalise|send|[^/]+\/adjust)|expenses(\/utilities)?|credit-notes(\/[^/]+)?|guest-documents(\/[^/]+\/void)?|owners(\/[^/]+\/adjustments(\/[^/]+)?)?|payment-vouchers(\/[^/]+)?|blocks|housekeeping\/tasks|maintenance\/issues|claims\/(receipts|requests)|units|contracts|guests)$/;

/** What a write says, to tell a second send of the same write from a new one. A form with files (a receipt) is told by
 *  its fields and each file's name, size and date. */
function contentOf(body: RequestInit['body']): string | null {
  if (typeof body === 'string') return body;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return JSON.stringify([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `${v.name}|${v.size}|${(v as File).lastModified ?? ''}`]));
  }
  return null;
}
/** The Idempotency-Key of each money or document write still in flight, or whose answer never arrived, by its exact
 *  content. Sending the same write again (a second click, or a retry after "Could not reach the server") reuses the
 *  key, so the server hands back the first answer instead of saving it twice. Once an answer arrives the key is let
 *  go, so the same entry made again on purpose is a new write. */
const writeKeys = new Map<string, string>();
const KEEP_UNANSWERED_MS = 10 * 60_000;

/** Writes that change no figures anyone reads: a person's own column order for a list (dragged headers, Columns menu).
 *  They leave the kept reads and snapshots alone, here and in other tabs. */
const LAYOUT_ONLY = /^\/table-layouts\/columns$/;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isRead = !init?.method || init.method === 'GET';
  if (!isRead && LAYOUT_ONLY.test(path.split('?')[0])) return requestOnce<T>(path, init, isRead);
  if (!isRead) {
    wrote();
    try { return await requestOnce<T>(path, init, isRead); } finally { wrote(); }
  }
  return requestOnce<T>(path, init, isRead);
}

/** A write whose answer never arrived, or arrived as a gateway error, may still have been saved: the server can carry
 *  on after the gateway gave up. "Try again" would invite a second copy, so it says to check first. */
const MAYBE_SAVED = 'No answer came back from the server in time, so this change may still have been saved. Refresh the page and check before trying again.';

async function requestOnce<T>(path: string, init: RequestInit | undefined, isRead: boolean): Promise<T> {
  const content = !isRead && init?.method !== 'DELETE' && ONCE.test(path.split('?')[0]) ? contentOf(init?.body) : null;
  const intent = content !== null ? `${init?.method} ${path} ${content}` : null;
  const key = intent ? writeKeys.get(intent) ?? crypto.randomUUID() : null;
  if (intent && key) writeKeys.set(intent, key);
  const send = () => fetch(`/api${path}`, {
    credentials: 'include',
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...init,
  });
  // A cold Hyperdrive pool after a quiet spell answers the first read with a gateway error; one retry clears it.
  // Writes are never retried, not even after a 503: the first attempt may have been applied. (One carrying an
  // Idempotency-Key could be, since the server would hand back the first answer; nothing replays them yet.)
  let res: Response | undefined;
  for (let attempt = 0; attempt < (isRead ? 2 : 1); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300));
    try {
      res = await send();
    } catch (e) {
      // A cancelled request is passed on as it is (useApi ignores it); it is not "could not reach the server".
      if (isAbort(e) || init?.signal?.aborted) throw e;
      res = undefined;
      continue;
    }
    if (!(isRead ? RETRY_READ_STATUS : RETRY_STATUS).has(res.status)) break;
  }
  if (intent) {
    // A 409 with Retry-After is "the first one is still being saved": that one's answer is still to come.
    const answered = res && !RETRY_STATUS.has(res.status) && !(res.status === 409 && res.headers.has('retry-after'));
    if (answered) writeKeys.delete(intent);
    else setTimeout(() => { if (writeKeys.get(intent) === key) writeKeys.delete(intent); }, KEEP_UNANSWERED_MS);
  }
  if (!res) throw new ApiFailure(0, 'NETWORK', isRead ? CODE_MESSAGE.NETWORK : MAYBE_SAVED);

  if (isRead) {
    if (/no-store/i.test(res.headers.get('cache-control') ?? '')) noStore.add(path); else noStore.delete(path);
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!res.ok) {
    const e = (body ?? {}) as ApiError;
    const code = e.error?.code ?? (res.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
    // The account is on a temporary password: the session re-reads itself and the app shows "Set a new password".
    if (code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('conts:password-change-required'));
    // A gateway error on a write: the platform's answer, not our server's, so it says nothing about whether it saved.
    if (!isRead && RETRY_STATUS.has(res.status) && !e.error?.message) throw new ApiFailure(res.status, code, MAYBE_SAVED, undefined, body);
    throw new ApiFailure(res.status, code, friendlyMessage(res.status, code, e.error?.message), e.error?.fields, body);
  }
  if (text && body === null) throw new ApiFailure(res.status, 'INTERNAL', 'The server sent an answer this screen could not read. Refresh the page and try again.');
  return body as T;
}

/** The sentence to show for any caught error. An ApiFailure's message is already written for people; anything else
 *  (a fault in the page, a browser error) becomes the fallback rather than its technical text. */
export function errorMessage(e: unknown, fallback = 'That did not work. Try again in a moment.'): string {
  if (e instanceof ApiFailure) return e.message;
  if (e instanceof Error && e.message && !TECHNICAL.test(e.message) && !/^[A-Z_]+$/.test(e.message)) return e.message;
  return fallback;
}

const qs = (params?: Record<string, string | number | boolean | undefined | null>) => {
  if (!params) return '';
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: <T>(path: string, params?: Parameters<typeof qs>[0]) => request<T>(`${path}${qs(params)}`),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  /** `body` is for the few deletes that need to say more, e.g. where to move people before a department goes. */
  del: <T>(path: string, body?: unknown) => request<T>(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body: JSON.stringify(body) }),
};

/**
 * Some mutations require an explicit confirmation round-trip. The API answers 428
 * with the consequence sentence; show it in a dialog, then retry with confirm.
 * See BUTTONS.md — calendar drag, reservation date change.
 */
export const CONFIRMATION_REQUIRED = 428;

/** Shows a red "Not saved" message for a change the server refused. Used where a screen updates itself first and sends the change after. */
export function notifyFailure(e: unknown) {
  const message = errorMessage(e, 'Try again in a moment.');
  window.dispatchEvent(new CustomEvent('conts:save-failed', { detail: message }));
}

/** GET a file (CSV, PDF) and hand it to the browser as a download. Throws with the server's message if it refuses. */
export async function downloadFile(path: string, params?: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
  let res: Response;
  try { res = await fetch(`/api${path}${p.toString() ? `?${p}` : ''}`, { credentials: 'include' }); }
  catch { throw new ApiFailure(0, 'NETWORK', CODE_MESSAGE.NETWORK); }
  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiError | null;
    throw new ApiFailure(res.status, body?.error?.code ?? 'UNKNOWN', friendlyMessage(res.status, body?.error?.code, body?.error?.message ?? 'The download failed. Try again.'));
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
export const CONFLICT = 409;
