/** Upper limits on any text sent to the API, checked once for every write in the middleware. Most endpoints trim
 *  only some fields, so a 500,000-character guest or owner name was saved as it came (11 Oct 2026) and then stretched
 *  every list, PDF and export it appeared in. A name or title is a line; anything else is at most a long note. */
export const NAME_MAX = 300;
export const TEXT_MAX = 10_000;

const NAME_KEY = /(?:^|[a-z_])(?:name|Name|title|Title)$/;

/** The first text value over its limit, as a field path and a sentence, or null when everything fits. */
export function overLimit(body: unknown, path = ''): { field: string; message: string } | null {
  if (typeof body === 'string') {
    const key = path.split('.').pop() ?? '';
    const max = NAME_KEY.test(key) ? NAME_MAX : TEXT_MAX;
    return body.length > max ? { field: path || 'body', message: `This is too long. Keep it under ${max.toLocaleString('en-MY')} characters.` } : null;
  }
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) { const r = overLimit(body[i], path ? `${path}.${i}` : String(i)); if (r) return r; }
    return null;
  }
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) { const r = overLimit(v, path ? `${path}.${k}` : k); if (r) return r; }
  }
  return null;
}
