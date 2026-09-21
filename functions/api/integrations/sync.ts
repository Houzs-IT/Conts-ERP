import { type Env, fail, audit } from '../../_lib/db';
import { requireSession } from '../../_lib/auth';

/** POST /api/integrations/sync — asks every channel to pull. No channel API is wired up yet, so this
 *  records the request and says so; it never reports a pull that did not happen. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireSession(request, env);
  if (!session) return response!;
  if (!['management', 'operations_manager', 'operations_staff'].includes(session.role)) return fail('FORBIDDEN', 'You cannot start a channel sync.', 403);

  await audit(env, { actorId: session.userId, actorLabel: session.fullName, action: 'integration.sync_requested', entityTable: 'integrations', entityId: 'all' });
  return fail('NOT_CONNECTED', 'Channel syncing is not connected yet. Bookings from Airbnb, Booking.com and Agoda are entered or imported by hand for now.', 501);
};
