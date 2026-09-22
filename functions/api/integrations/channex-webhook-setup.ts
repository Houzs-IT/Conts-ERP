import { type Env, json, fail } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { channexConfigured, channexListWebhooks, channexCreateWebhook } from '../../_lib/channex';

/** GET /api/integrations/channex-webhook-setup — lists what Channex has registered for us, so we
 *  can see whether the booking-in webhook is already set up.
 *  POST — registers it if it is not. Idempotent: safe to call again. Management-only and
 *  temporary, same as channex-test.ts — remove once stage 5 folds this into onboarding a real
 *  listing. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can use this.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'CHANNEX_API_KEY is not set on this environment.', 501);

  const res = await channexListWebhooks(env);
  if (!res.ok) return fail('CHANNEX_ERROR', `Channex refused the read (status ${res.status}).`, 502);
  return json({ webhooks: (res.body?.data ?? []).map((w: any) => ({ id: w.id, ...w.attributes })) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (session.role !== 'management') return fail('FORBIDDEN', 'Only management can use this.', 403);
  if (!channexConfigured(env)) return fail('NOT_CONFIGURED', 'CHANNEX_API_KEY is not set on this environment.', 501);
  if (!env.CHANNEX_WEBHOOK_SECRET) return fail('NOT_CONFIGURED', 'CHANNEX_WEBHOOK_SECRET is not set on this environment.', 501);

  const b = await request.json<{ callbackUrl?: string }>().catch(() => ({}) as { callbackUrl?: string });
  const callbackUrl = b.callbackUrl ?? `${new URL(request.url).origin}/api/integrations/channex-webhook`;

  const existing = await channexListWebhooks(env);
  const already = (existing.body?.data ?? []).find((w: any) => w.attributes?.callback_url === callbackUrl);
  if (already) return json({ alreadyRegistered: true, id: already.id, callbackUrl });

  const res = await channexCreateWebhook(env, { callbackUrl, secret: env.CHANNEX_WEBHOOK_SECRET });
  if (!res.ok) return fail('CHANNEX_ERROR', `Channex refused the webhook registration (status ${res.status}).`, 502);
  return json({ registered: true, id: res.body?.data?.id, callbackUrl });
};
