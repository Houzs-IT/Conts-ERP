/** ETag and 304 on the GETs the screens ask for on a timer, so an unchanged poll costs headers, not the list (Houzs
 *  26fd7139b, Hookka 0d17520ad). The browser keeps the last answer and sends its tag back as If-None-Match by itself;
 *  a match gets an empty 304 and the page is handed the kept copy as a 200, so no screen changes. Who polls what:
 *    /api/notifications/count   the bell, every minute (NotificationBell.tsx)
 *    /api/nav/badges            the side menu's counts, every minute (lib/navBadges.ts)
 *    /api/housekeeping/board    the Cleaning board, every 30 s (CleaningPage.tsx)
 *    /api/field/tasks           the cleaner's Today list, every 30 s (FieldTodayPage.tsx)
 *    /api/field/repairs         the technician's repairs, every minute (FieldRepairsPage.tsx)
 *  The Maintenance list is not polled, so it is not here. */
const POLLED = /^\/api\/(notifications\/count|nav\/badges|housekeeping\/board|field\/tasks|field\/repairs)$/;

/** `private`: no shared cache (Cloudflare's edge included) keeps it. `no-cache`: the browser may keep a copy but asks
 *  on every poll, so a change still shows on the very next one. */
export const POLL_CACHE_CONTROL = 'private, no-cache';

export const isPolled = (method: string, path: string) => method === 'GET' && POLLED.test(path);

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** The tag covers the body and who asked (user and role), so a tag kept from another account's copy in the same
 *  browser never matches, even when the two answers are byte for byte the same. */
export async function pollEtagFor(body: ArrayBuffer, identity: string): Promise<string> {
  const prefix = new TextEncoder().encode(`${identity}\n`);
  const joined = new Uint8Array(prefix.byteLength + body.byteLength);
  joined.set(prefix, 0);
  joined.set(new Uint8Array(body), prefix.byteLength);
  return `"${hex(await crypto.subtle.digest('SHA-1', joined))}"`;
}

/** Cloudflare weakens a strong tag to W/"…" when it compresses the body, so the browser may send the weak form back.
 *  If-None-Match compares weakly (RFC 9110 13.1.2). */
export function ifNoneMatchHits(header: string | null, tag: string): boolean {
  if (!header) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, '');
  const want = strip(tag);
  return header.split(',').some(t => t.trim() === '*' || strip(t) === want);
}

/** Tags a polled GET's 200 JSON answer, or answers 304 when the browser already holds it. Anything else (an error,
 *  another content type, an answer that chose its own caching) passes untouched. */
export async function withPollEtag(request: Request, response: Response, identity: string): Promise<Response> {
  if (response.status !== 200) return response;
  if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return response;
  if (response.headers.has('etag') || response.headers.has('cache-control')) return response;
  const body = await response.arrayBuffer();
  const tag = await pollEtagFor(body, identity);
  const headers = new Headers(response.headers);
  headers.set('etag', tag);
  headers.set('cache-control', POLL_CACHE_CONTROL);
  headers.append('vary', 'Cookie');
  if (ifNoneMatchHits(request.headers.get('if-none-match'), tag)) {
    for (const h of ['content-type', 'content-length', 'content-encoding']) headers.delete(h);
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, statusText: response.statusText, headers });
}
