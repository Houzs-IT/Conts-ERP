import { type Env } from './db';
import { type Session, isFieldRole } from './auth';
import { levelsFor } from './access';

/** The areas whose screens come from the engine. Keep in step with engine/backend/src/conts/access.ts. */
const ENGINE_AREAS = ['scSales', 'scInvoices', 'scConsignment', 'scProcurement', 'scTransportPlan', 'scWarehouse', 'serviceCases', 'projects'];

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
  const levels = await levelsFor(env, session.role);
  const access = Object.fromEntries(ENGINE_AREAS.map(k => [k, levels[k]]));
  const body = b64url(enc.encode(JSON.stringify({ email: session.email, name: session.fullName, role: session.role, access, exp: Date.now() + 45_000 })));
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SCM_ENGINE_SSO_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${b64url(await crypto.subtle.sign('HMAC', key, enc.encode(body)))}`;
}
