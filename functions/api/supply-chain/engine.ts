import { type Env, json } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { scmEngineConfigured, mayUseScmEngine } from '../../_lib/scmEngine';

/** GET /api/supply-chain/engine — whether the supply chain screens come from the engine on this
 *  environment, for this person. Where it is not set up, the built-in screens are used. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  return json({ enabled: scmEngineConfigured(env) && mayUseScmEngine(session) });
};
