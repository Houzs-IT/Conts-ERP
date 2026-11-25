/**
 * AI Connector: runs one GET through the real API in-process, the way Cloudflare Pages would run it: the session
 * middleware first (functions/api/_middleware.ts), then the handler the route table matches (apiRoutes.generated.ts,
 * in Pages' own order; an unknown path reaches the catch-all 404). Nothing goes over the network, so the per-isolate
 * secret on the request (mcpInner.ts) is only ever seen by this isolate.
 *
 * It runs inside the connector request's own database client (withRequestDb in the middleware's onRequest), so a read
 * costs no extra connection; an error is answered here the way the middleware's onRequest would answer it.
 */
import { type Env, fail, json, transientDb } from './db';
import { apiRoutes } from './apiRoutes.generated';
import { matchRoute } from './mcpRoutes';
import { handleApiRequest } from '../api/_middleware';

type Ctx = Parameters<PagesFunction<Env>>[0];

export async function dispatchGet(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  const data: Record<string, unknown> = {};
  const base = { env, waitUntil, passThroughOnException: () => {}, data } as unknown as Omit<Ctx, 'request' | 'next' | 'params' | 'functionPath'>;
  let used = false;
  const next = async (input?: Request | string, init?: RequestInit): Promise<Response> => {
    if (used) return fail('INTERNAL', 'The request was answered twice.', 500);
    used = true;
    const req = input === undefined ? request : typeof input === 'string' ? new Request(new URL(input, request.url), init) : input;
    const path = new URL(req.url).pathname;
    const hit = matchRoute(apiRoutes(), path);
    if (!hit) return fail('NOT_FOUND', 'That address does not exist.', 404);
    const run = hit.route.handler as unknown as (c: Ctx) => Response | Promise<Response>;
    return run({ ...base, request: req, params: hit.params, functionPath: path, next: () => fail('NOT_FOUND', 'That address does not exist.', 404) } as unknown as Ctx);
  };
  try {
    return await handleApiRequest({ ...base, request, params: {}, functionPath: new URL(request.url).pathname, next } as unknown as Ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.startsWith('Demo: ')) return fail('DEMO_MODE', msg, 409);
    if (transientDb(e)) return json({ error: { code: 'BUSY', message: 'The server is busy right now. Wait a moment and try again.' } }, 503, { 'retry-after': '1' });
    console.error('AI Connector read failed', new URL(request.url).pathname, e);
    return fail('INTERNAL', 'Something went wrong on our side and this could not load.', 500);
  }
}
