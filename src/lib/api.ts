import type { ApiError } from './types';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Already user-safe. Render it directly — see api.md conventions. */
    message: string,
    public fields?: Record<string, string>,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiFailure';
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
  INTERNAL: 'Something went wrong on our side and nothing was saved. Try again; if it keeps happening, tell IT.',
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiFailure(0, 'NETWORK', CODE_MESSAGE.NETWORK);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!res.ok) {
    const e = (body ?? {}) as ApiError;
    const code = e.error?.code ?? (res.status >= 500 ? 'INTERNAL' : 'UNKNOWN');
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
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
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
