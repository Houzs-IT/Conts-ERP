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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const e = (body ?? {}) as ApiError;
    throw new ApiFailure(
      res.status,
      e.error?.code ?? 'UNKNOWN',
      e.error?.message ?? 'Something failed and we could not read why. Try again.',
      e.error?.fields,
      body,
    );
  }
  return body as T;
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
  const message = e instanceof Error ? e.message : 'Try again in a moment.';
  window.dispatchEvent(new CustomEvent('conts:save-failed', { detail: message }));
}

/** GET a file (CSV, PDF) and hand it to the browser as a download. Throws with the server's message if it refuses. */
export async function downloadFile(path: string, params?: Record<string, string | number | undefined | null>) {
  const p = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); });
  const res = await fetch(`/api${path}${p.toString() ? `?${p}` : ''}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as ApiError | null;
    throw new ApiFailure(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'The download failed. Try again.');
  }
  const blob = await res.blob();
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'download';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
export const CONFLICT = 409;
