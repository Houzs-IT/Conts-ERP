import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { scmEngineConfigured, mayUseScmEngine, scmEngineAssertion } from '../../_lib/scmEngine';

/** POST /api/supply-chain/engine-session — signs the person into the supply chain engine on their behalf,
 *  so the engine's screens open inside this app with no second sign-in. Returns the engine's site and a
 *  session for it; the secret that proves the request stays between the two servers. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayUseScmEngine(session)) return fail('FORBIDDEN', 'Your account does not have access to supply chain records.', 403);
  if (!scmEngineConfigured(env)) return fail('NOT_CONFIGURED', 'The supply chain engine is not set up on this environment.', 501);

  let res: Response;
  try {
    res = await fetch(`${env.SCM_ENGINE_API!.replace(/\/+$/, '')}/api/conts-sso`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assertion: await scmEngineAssertion(env, session) }),
    });
  } catch {
    return fail('ENGINE_UNREACHABLE', 'The supply chain engine could not be reached. Try again in a moment.', 502);
  }
  const body = await res.json<{ token?: string; session_pass?: string; error?: string }>().catch(() => null);
  if (res.status === 403) return fail('FORBIDDEN', body?.error ?? 'Your account does not have access to supply chain.', 403);
  if (!res.ok || !body?.token) return fail('ENGINE_REFUSED', `The supply chain engine did not sign you in (${res.status}).`, 502);
  return json({ site: env.SCM_ENGINE_SITE!.replace(/\/+$/, ''), token: body.token, sessionPass: body.session_pass ?? null });
};
