/**
 * AI Connector: the API's own routes, matched the way Cloudflare Pages matches them, so a connector read can run the
 * real handler in-process (functions/_lib/mcpDispatch.ts). The table itself is generated from the functions/api file
 * tree by scripts/gen-api-routes.mjs into apiRoutes.generated.ts (npm run check fails when it is stale).
 *
 * Pages turns `[id]` into one path segment and `[[path]]` into any number of segments (zero included), sorts the
 * routes most specific first (wrangler's compareRoutes: more segments first, then static before :param before
 * catch-all, then routes that name a method before those that do not, then by path) and runs the first one that
 * matches. Pure, so it is unit-tested (src/lib/mcpAccess.test.mjs).
 */

/** A handler as the generated table holds it; dispatch passes it a full Pages context. */
export type RouteHandler = (ctx: never) => Response | Promise<Response>;
export interface ApiRoute { path: string; method: '' | 'GET'; handler: RouteHandler }

const compiled = new WeakMap<ApiRoute, { re: RegExp; keys: { name: string; many: boolean }[] }>();

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\*]/g, '\\$&');

/** The regular expression for one route path such as /api/units/:id or /api/:path*. */
export function compileRoute(path: string): { re: RegExp; keys: { name: string; many: boolean }[] } {
  const keys: { name: string; many: boolean }[] = [];
  let src = '';
  for (const seg of path.split('/').filter(Boolean)) {
    const many = /^:(\w+)\*$/.exec(seg);
    const one = /^:(\w+)$/.exec(seg);
    if (many) { keys.push({ name: many[1], many: true }); src += '(?:/([^/]+(?:/[^/]+)*))?'; }
    else if (one) { keys.push({ name: one[1], many: false }); src += '/([^/]+?)'; }
    else src += `/${escape(seg)}`;
  }
  return { re: new RegExp(`^${src || ''}/?$`, 'i'), keys };
}

/** The first route that answers a GET of `path`, with its params, or null. `routes` is in Pages' order. */
export function matchRoute(routes: ApiRoute[], path: string): { route: ApiRoute; params: Record<string, string | string[]> } | null {
  for (const route of routes) {
    let c = compiled.get(route);
    if (!c) { c = compileRoute(route.path); compiled.set(route, c); }
    const m = c.re.exec(path);
    if (!m) continue;
    const params: Record<string, string | string[]> = {};
    c.keys.forEach((k, i) => {
      const v = m[i + 1];
      if (v === undefined) return;
      params[k.name] = k.many ? v.split('/') : v;
    });
    return { route, params };
  }
  return null;
}
