import { mayWork } from '../../../_lib/access';
import { type Env, one, fail, json, audit } from '../../../_lib/db';
import { requireSession } from '../../../_lib/auth';
import { channexConfigured } from '../../../_lib/channex';
import { processChannexBookingFeed } from '../../../_lib/channexBookingSync';
import { processChannexMessagesAndReviews } from '../../../_lib/channexMessageSync';

/** Airbnb, Booking.com and Agoda are one Channex account behind the scenes, so any one of them
 *  syncs the same shared account as the others. Other providers have no API wired up yet. */
const CHANNEX_PROVIDERS = ['airbnb', 'booking_com', 'agoda'];

/** POST /api/integrations/:provider/sync — see integrations/sync.ts. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!mayWork(session, ['management'])) return fail('FORBIDDEN', 'You cannot check the channels for new reservations.', 403);

  const provider = String(params.provider);
  const row = await one<{ id: string }>(env, 'SELECT id FROM integrations WHERE provider = ?', provider);
  if (!row) return fail('NOT_FOUND', 'That integration is not configured.', 404);
  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.sync_requested', entityTable: 'integrations', entityId: row.id });

  if (!CHANNEX_PROVIDERS.includes(provider) || !channexConfigured(env)) {
    return fail('NOT_CONNECTED', 'Channels are not connected yet. Reservations are entered or imported by hand for now.', 501);
  }
  const bookings = await processChannexBookingFeed(env);
  const rest = await processChannexMessagesAndReviews(env);
  return json({ ok: true, bookings, ...rest });
};
