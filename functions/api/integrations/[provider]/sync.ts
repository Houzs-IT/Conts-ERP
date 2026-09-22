import { type Env, one, fail, json, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { channexConfigured } from '../../../_lib/channex';
import { processChannexBookingFeed } from '../../../_lib/channexBookingSync';

/** Airbnb, Booking.com and Agoda are one Channex account behind the scenes, so any one of them
 *  syncs the same shared feed as the others. Other providers have no API wired up yet. */
const CHANNEX_PROVIDERS = ['airbnb', 'booking_com', 'agoda'];

/** POST /api/integrations/:provider/sync — see integrations/sync.ts. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager', 'operations_staff'].includes(session.role)) return fail('FORBIDDEN', 'You cannot start a channel sync.', 403);

  const provider = String(params.provider);
  const row = await one<{ id: string }>(env, 'SELECT id FROM integrations WHERE provider = ?', provider);
  if (!row) return fail('NOT_FOUND', 'That integration is not configured.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.sync_requested', entityTable: 'integrations', entityId: row.id });

  if (!CHANNEX_PROVIDERS.includes(provider) || !channexConfigured(env)) {
    return fail('NOT_CONNECTED', 'Channel syncing is not connected yet. Bookings are entered or imported by hand for now.', 501);
  }
  const result = await processChannexBookingFeed(env);
  return json({ ok: true, ...result });
};
