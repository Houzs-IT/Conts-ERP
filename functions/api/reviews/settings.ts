import { mayRun } from '../../_lib/access';
import { type Env, json, fail, audit } from '../../_lib/db';
import { requireSession, isFieldRole } from '../../_lib/auth';
import { aiConfigured, aiEnabled, setAiEnabled } from '../../_lib/aiDraft';

/** GET /api/reviews/settings — Reviews settings: whether AI draft replies are set up (the ANTHROPIC_API_KEY secret)
 *  and turned on. PUT { aiDrafts: boolean } turns them on or off (Full access in Pricing and reviews). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (isFieldRole(session.role) || session.role === 'owner') return fail('FORBIDDEN', 'Reviews are visible to operations, finance and management.', 403);
  return json({ aiConfigured: aiConfigured(env), aiDrafts: await aiEnabled(env) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayRun(session, ['management'])) return fail('FORBIDDEN', 'Only management can change Reviews settings.', 403);
  const b = await request.json<any>().catch(() => null);
  if (typeof b?.aiDrafts !== 'boolean') return fail('VALIDATION', 'Say whether AI draft replies are on.', 422);
  const before = await aiEnabled(env);
  await setAiEnabled(env, b.aiDrafts);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'reviews.settings', entityTable: 'settings', entityId: 'reviews.ai_drafts', before: { aiDrafts: before }, after: { aiDrafts: b.aiDrafts } });
  return json({ aiConfigured: aiConfigured(env), aiDrafts: b.aiDrafts });
};
