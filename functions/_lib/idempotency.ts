import { type Env, all, run, fail } from './db';
import { hasColumn } from './auth';

/** Migration 0107. Without the table the Idempotency-Key header is ignored and writes run exactly as before. */
export function idempotencyTable(env: Env) {
  return hasColumn(env, 'idempotency_keys', 'request_hash');
}

const WRITES = new Set(['POST', 'PATCH', 'PUT']);
const MAX_BODY = 1024 * 1024;
// The same sentence the API middleware answers a thrown write with: the write may have saved part of its work.
const THREW = JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong on our side. Refresh the page to see whether the change was saved before trying again; if it keeps happening, tell IT.' } });

async function sha256(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Runs `write` once per (person, Idempotency-Key) for 24 hours. A repeat of the same request gets the first answer
 * back (header Idempotent-Replay: true) instead of a second payment, payout or document. Every answer is kept, not
 * only successes, because a write that failed half way may already have saved something. A repeat that arrives while
 * the first is still running is told so (409) rather than run alongside it; the same key with a different request is
 * refused (409), since replaying the first answer for it would claim the wrong thing was saved.
 */
export async function once(env: Env, request: Request, userId: string, write: () => Promise<Response>): Promise<Response> {
  const raw = request.headers.get('idempotency-key');
  if (raw === null || !WRITES.has(request.method) || !(await idempotencyTable(env))) return write();
  const key = raw.trim();
  if (!/^[\x21-\x7e]{1,200}$/.test(key)) return fail('VALIDATION', 'The request key sent with this change is not valid. Refresh the page and try again.', 400);
  const body = await request.clone().text();
  if (body.length > MAX_BODY) return write();
  const url = new URL(request.url);
  const hash = await sha256(`${request.method}\n${url.pathname}${url.search}\n${body}`);

  let claimed = false;
  try {
    // Expired keys go first, so a key older than 24 hours is free to use again.
    await run(env, `DELETE FROM idempotency_keys WHERE user_id = ? AND created_at < now() - interval '24 hours'`, userId);
    claimed = (await all(env,
      'INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING RETURNING 1 AS x',
      userId, key, hash)).length > 0;
  } catch (e) {
    // Asked to run once and unable to record it: refusing is safer than a write nobody can match a retry to.
    console.error('idempotency claim failed', e);
    return fail('UNAVAILABLE', 'This change could not be safely recorded just now. Nothing was saved. Wait a moment and try again.', 503);
  }

  if (!claimed) {
    const [first] = await all<{ request_hash: string; status: number | null; response_body: string | null }>(env,
      'SELECT request_hash, status, response_body FROM idempotency_keys WHERE user_id = ? AND key = ?', userId, key);
    if (!first || first.status === null) {
      return new Response(JSON.stringify({ error: { code: 'IN_PROGRESS', message: 'This is still being saved. Wait a moment, then refresh to see it; do not send it again.' } }),
        { status: 409, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '1' } });
    }
    if (first.request_hash !== hash) {
      return fail('CONFLICT', 'An earlier change sent with this key was different. Refresh and check what was saved before sending this again.', 409);
    }
    return new Response(first.status === 204 ? null : first.response_body ?? '', {
      status: first.status, headers: { 'content-type': 'application/json; charset=utf-8', 'idempotent-replay': 'true' },
    });
  }

  let response: Response;
  try {
    response = await write();
  } catch (e) {
    await run(env, 'UPDATE idempotency_keys SET status = 500, response_body = ? WHERE user_id = ? AND key = ?', THREW, userId, key).catch(() => {});
    throw e;
  }
  try {
    const text = await response.clone().text();
    await run(env, 'UPDATE idempotency_keys SET status = ?, response_body = ? WHERE user_id = ? AND key = ?',
      response.status, text.length > MAX_BODY ? null : text, userId, key);
  } catch (e) {
    // The write itself is done; a retry then sees "still being saved" until the key expires, never a second write.
    console.error('idempotency record failed', e);
  }
  return response;
}
