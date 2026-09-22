import { type Env, json } from '../../_lib/db';
import { processChannexBookingFeed } from '../../_lib/channexBookingSync';

/** POST /api/integrations/channex-webhook — Channex calls this whenever a booking is created,
 *  changed or cancelled (registered by channex-webhook-setup.ts). There is no session: the
 *  caller is Channex's server, not a browser, so it is verified instead by a shared secret
 *  Channex echoes back in a header on every call. Always answers 200 once verified — Channex
 *  expects that even when something goes wrong on our side, and retries hard for hours otherwise
 *  (https://docs.channex.io/api-v.1-documentation/webhook-collection). The webhook payload itself
 *  only carries an id, and delivery order is not guaranteed, so it is just a "go check now"
 *  trigger — the real work is pulling and acknowledging the feed, which is also what the manual
 *  "sync now" button runs. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = env.CHANNEX_WEBHOOK_SECRET;
  if (!secret || request.headers.get('x-channex-webhook-secret') !== secret) {
    return json({ ok: false, reason: 'unauthorized' }, 401);
  }
  const result = await processChannexBookingFeed(env).catch(() => ({ processed: 0, skipped: 0 }));
  return json({ ok: true, ...result });
};
