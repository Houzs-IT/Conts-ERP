import { type Env } from './db';
import { type Session, isFieldRole } from './auth';
import { levelsFor } from './access';

/** The areas whose screens come from the engine. Keep in step with engine/backend/src/conts/access.ts. */
const ENGINE_AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scProduction', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'serviceMetrics', 'projects', 'projectDefects', 'projectHandover', 'projectFinances', 'ledger', 'mail'];

/** The supply chain engine is Houzs's code run as its own server and site (see engine/ and CLAUDE.md).
 *  It is in use on an environment only when all three settings are present. */
export const scmEngineConfigured = (env: Env) => !!(env.SCM_ENGINE_API && env.SCM_ENGINE_SITE && env.SCM_ENGINE_SSO_SECRET);

/** The same rule as the supply chain API gate in _middleware.ts: field accounts and owners have no supply chain. */
export const mayUseScmEngine = (session: Session) => !isFieldRole(session.role) && session.role !== 'owner';

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A one-minute statement of who is signed in here, signed with the secret only the two servers hold.
 *  The engine checks it and opens a session for that person (engine/backend/src/conts/sso.ts). */
export async function scmEngineAssertion(env: Env, session: Session): Promise<string> {
  const enc = new TextEncoder();
  // The role's level in each engine area travels with the sign-on, so the engine enforces the same chart.
  const levels = await levelsFor(env, session);
  const access = Object.fromEntries(ENGINE_AREAS.map(k => [k, levels[k]]));
  const body = b64url(enc.encode(JSON.stringify({ email: session.email, name: session.fullName, role: session.role, access, exp: Date.now() + 45_000 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SCM_ENGINE_SSO_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)))}`;
}

/** A one-minute statement, for the engine's staff claim routes, of which staff member a forwarded call is for: their
 *  Property OS user id and email, signed with the same secret as the sign-on and marked `aud: 'claims'` so neither
 *  can be used as the other (engine/backend/src/conts/staff-identity.ts). Field accounts and office staff alike:
 *  every claim call goes through here, so no one needs an engine account to hand in a receipt. */
export async function claimsAssertion(env: Env, session: Session): Promise<string> {
  const enc = new TextEncoder();
  const body = b64url(enc.encode(JSON.stringify({ aud: 'claims', userId: session.userId, email: session.email, exp: Date.now() + 45_000 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SCM_ENGINE_SSO_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)))}`;
}

/** One supply chain record found by the top-bar search: the engine's own answer (engine/backend/src/services/renovation/
 *  renovationSearch.ts). `path` is the engine screen that opens it. */
export interface EngineSearchHit { kind: string; id: string; label: string; sub: string; date: string | null; path: string }
export type EngineSearch = { hits: EngineSearchHit[]; degraded: string[]; failed?: boolean };

/** A one-minute statement for the engine's search, marked `aud: 'search'` so it opens nothing else, carrying the levels
 *  the person's role holds in each engine area: the engine searches only the kinds those open. */
async function searchAssertion(env: Env, session: Session, levels: Record<string, string>): Promise<string> {
  const enc = new TextEncoder();
  const access = Object.fromEntries(ENGINE_AREAS.map(k => [k, levels[k] ?? 'none']));
  const body = b64url(enc.encode(JSON.stringify({ aud: 'search', email: session.email, access, exp: Date.now() + 45_000 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SCM_ENGINE_SSO_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)))}`;
}

/** The engine areas the person may search at all. */
export const engineSearchOpen = (levels: Record<string, string>) => ENGINE_AREAS.some(k => k !== 'ledger' && k !== 'mail' && (levels[k] ?? 'none') !== 'none');

/** Asks the engine, server to server, for the supply chain records matching `q`. Never throws and never holds the
 *  search up for long: an engine that is down or slow answers `failed`, and the box still shows the rental records. A
 *  person with no engine account yet (never opened Supply chain) is signed on once, which makes it, and asked again. */
export async function searchEngine(env: Env, session: Session, levels: Record<string, string>, q: string, opts: { only?: string | null; limit: number }): Promise<EngineSearch> {
  const base = env.SCM_ENGINE_API!.replace(/\/+$/, '');
  const ask = async () => fetch(`${base}/api/conts-search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-conts-search': await searchAssertion(env, session, levels) },
    body: JSON.stringify({ q, only: opts.only ?? null, limit: opts.limit }),
    signal: AbortSignal.timeout(6000),
  });
  try {
    let res = await ask();
    if (res.status === 409) {
      const signOn = await fetch(`${base}/api/conts-sso`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assertion: await scmEngineAssertion(env, session) }), signal: AbortSignal.timeout(6000),
      });
      if (!signOn.ok) return { hits: [], degraded: [], failed: signOn.status !== 403 };
      res = await ask();
    }
    if (!res.ok) return { hits: [], degraded: [], failed: true };
    const body = await res.json<{ hits?: EngineSearchHit[]; degraded?: string[] }>();
    return { hits: Array.isArray(body.hits) ? body.hits : [], degraded: Array.isArray(body.degraded) ? body.degraded : [] };
  } catch {
    return { hits: [], degraded: [], failed: true };
  }
}
