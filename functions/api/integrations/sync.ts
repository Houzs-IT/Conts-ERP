import { type Env, fail, json, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';
import { channexConfigured } from '../../_lib/channex';
import { processChannexBookingFeed } from '../../_lib/channexBookingSync';
import { processChannexMessagesAndReviews } from '../../_lib/channexMessageSync';

/** POST /api/integrations/sync — asks every channel to pull. Channex covers Airbnb, Booking.com
 *  and Agoda through one shared account (bookings, messages and reviews); other providers
 *  (WhatsApp, Maybank, utilities) have no API wired up yet, so this still says so honestly when
 *  Channex is not configured. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager', 'operations_staff'].includes(session.role)) return fail('FORBIDDEN', 'You cannot start a channel sync.', 403);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.sync_requested', entityTable: 'integrations', entityId: 'all' });
  if (!channexConfigured(env)) return fail('NOT_CONNECTED', 'Channel syncing is not connected yet. Bookings from Airbnb, Booking.com and Agoda are entered or imported by hand for now.', 501);

  const bookings = await processChannexBookingFeed(env);
  const rest = await processChannexMessagesAndReviews(env);
  return json({ ok: true, bookings, ...rest });
};
