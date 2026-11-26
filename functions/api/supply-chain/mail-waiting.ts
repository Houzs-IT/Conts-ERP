import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { levelsFor } from '../../_lib/access';
import { scmEngineConfigured, mayUseScmEngine, scmEngineAssertion } from '../../_lib/scmEngine';

/** GET /api/supply-chain/mail-waiting — the Mail Center "waiting for my reply" count for the signed-in person: open
 *  threads whose last message is the customer's, assigned to them or unassigned in their own mailbox. It is the same
 *  number Mail Center shows under My mailbox (engine GET /api/mail-center/waiting-count), read server to server so the
 *  AI Connector's daily brief can include it (AI Connector round 4, owner 26 Nov 2026): the connector only makes GETs,
 *  and opening Mail Center needs the POST sign-on (engine-session) that the read-only connector never makes.
 *
 *  Same gate as the Mail menu item and the Mail Center screen: no field or owner accounts (mayUseScmEngine), the
 *  person's Mail Center area not closed (levelsFor .mail), and the engine applies its own mailbox access. The engine
 *  session it opens is signed out straight after. Opening it is what the Mail Center screen does too, including the
 *  engine's own first-sign-on work (an engine account, a personal mailbox when the person has none). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseScmEngine(session)) return fail('FORBIDDEN', 'Your account does not have access to Mail Center.', 403);
  if (!scmEngineConfigured(env)) return fail('NOT_CONFIGURED', 'Mail Center is not set up on this environment.', 501);
  if (((await levelsFor(env, session)).mail ?? 'none') === 'none') return fail('FORBIDDEN', 'Your access does not include Mail Center.', 403);

  const api = env.SCM_ENGINE_API!.replace(/\/+$/, '');
  let signOn: Response;
  try {
    signOn = await fetch(`${api}/api/conts-sso`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion: await scmEngineAssertion(env, session) }), signal: AbortSignal.timeout(6000),
    });
  } catch {
    return fail('ENGINE_UNREACHABLE', 'Mail Center could not be reached. Try again in a moment.', 502);
  }
  const s = await signOn.json<{ token?: string; session_pass?: string }>().catch(() => null);
  if (signOn.status === 403) return fail('FORBIDDEN', 'Your account does not have access to Mail Center.', 403);
  if (!signOn.ok || !s?.token) return fail('ENGINE_REFUSED', `Mail Center did not open for your account (${signOn.status}).`, 502);
  const auth: Record<string, string> = { authorization: `Bearer ${s.token}`, ...(s.session_pass ? { 'x-session-pass': s.session_pass } : {}) };
  try {
    const res = await fetch(`${api}/api/mail-center/waiting-count`, { headers: auth, signal: AbortSignal.timeout(6000) });
    const b = await res.json<{ count?: unknown }>().catch(() => null);
    if (res.status === 401 || res.status === 403) return fail('FORBIDDEN', 'Your account does not have access to Mail Center.', 403);
    if (!res.ok) return fail('ENGINE_REFUSED', `Mail Center did not answer (${res.status}).`, 502);
    const count = Number(b?.count ?? 0);
    return json({ count: Number.isFinite(count) && count > 0 ? count : 0, target: '/mail' }, 200, { 'cache-control': 'no-store' });
  } catch {
    return fail('ENGINE_UNREACHABLE', 'Mail Center could not be reached. Try again in a moment.', 502);
  } finally {
    waitUntil(fetch(`${api}/api/auth/logout`, { method: 'POST', headers: auth, signal: AbortSignal.timeout(10_000) }).catch(() => undefined));
  }
};
