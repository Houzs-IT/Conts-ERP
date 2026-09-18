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
export const CONFLICT = 409;
