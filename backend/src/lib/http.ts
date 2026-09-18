import type { Context } from 'hono';

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Not signed in') => new HttpError(401, m);
export const forbidden = (m = 'Not allowed') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/** The one place an error becomes a response, so nothing leaks a stack trace. */
export function onError(err: Error, c: Context) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, detail: err.detail ?? null }, err.status as 400);
  }
  console.error('unhandled', err?.stack ?? err);
  return c.json({ error: 'Something went wrong' }, 500);
}

/** Caller IP and browser, recorded on every write in the audit log. */
export function requestMeta(c: Context) {
  return {
    ip: c.req.header('cf-connecting-ip') ?? null,
    userAgent: c.req.header('user-agent') ?? null,
  };
}
