/**
 * Typed API boundary — the ERPs' `fetch-json.ts` pattern (Hookka). Fetch, parse,
 * and Zod-validate the response envelope so every call site gets a typed, checked
 * result. Mutations never retry; reads may be wrapped by `useCachedJson`.
 */
import { z } from 'zod';
import { friendlyMessage } from './api';

export class FetchJsonError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'FetchJsonError';
  }
}

export async function fetchJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url.startsWith('http') || url.startsWith('/') ? url : `/api${url}`, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } : init?.headers,
    ...init,
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new FetchJsonError(res.status, friendlyMessage(res.status, e?.code, e?.message), body);
  }
  return schema.parse(body);
}

/** `{ data, generatedAt? }` — the standard list envelope this app returns. */
export const envelope = <T>(data: z.ZodType<T>) =>
  z.object({ data, generatedAt: z.string().optional(), total: z.number().optional(), page: z.number().optional() });
