/* The generic sales-order write routes refuse renovation contracts.

   A renovation SO's lines mirror its contract structure (scm.reno_doc_lines)
   and its money is billed by instalment, so a line PATCH, a status change or a
   delete through /mfg-sales-orders would split the two apart. Changes go
   through the renovation routes instead (VO for lines and prices, its own
   status route). Payments, hold and photos keep working as for any order.

   Fails closed: if the order's kind cannot be read the write is refused (503). */

import type { Context, MiddlewareHandler } from 'hono';

const PASS_THROUGH = [
  /^payments(\/.*)?$/,
  /^(hold|unhold|on-hold)(\/.*)?$/,
  /^items\/[^/]+\/photos(\/.*)?$/,
  /^photos(\/.*)?$/,
];

/** `rest` is the path after /:docNo/ (empty for /:docNo itself). */
export function renovationFenceApplies(method: string, rest: string): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return !PASS_THROUGH.some((re) => re.test(rest));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the router's own Context type
type KindLookup = (c: Context<any>, docNo: string) => Promise<{ kind: string | null; error: boolean }>;

/** Middleware for the /mfg-sales-orders router. `lookup` reads so_kind. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mounted on routers with their own Env/Variables
export function renovationSoWriteFence(lookup: KindLookup): MiddlewareHandler<any> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const m = /\/mfg-sales-orders\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (!m) return next();
    const docNo = decodeURIComponent(m[1]);
    if (!renovationFenceApplies(c.req.method, m[2] ?? '')) return next();
    let r: { kind: string | null; error: boolean };
    try { r = await lookup(c, docNo); } catch { r = { kind: null, error: true }; }
    if (r.error) {
      return c.json({ error: 'so_kind_unreadable', message: 'Could not confirm what kind of order this is. Nothing was changed; try again.' }, 503);
    }
    if (r.kind === 'RENOVATION') {
      return c.json({
        error: 'renovation_so_write_refused',
        message: 'This is a renovation contract. Change its lines through a variation order and its status on the renovation contract screen.',
      }, 409);
    }
    return next();
  };
}
